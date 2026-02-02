
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verifyToken, clerkClient } from '@clerk/clerk-sdk-node';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
    private readonly logger = new Logger(ClerkAuthGuard.name);

    constructor(private readonly prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token = request.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            this.logger.warn('No token provided');
            throw new UnauthorizedException('No token provided');
        }

        try {
            const verifiedToken = await verifyToken(token, {
                secretKey: process.env.CLERK_SECRET_KEY,
                clockSkewInMs: 60000, // 60s leeway
            } as any);

            // Accessing claims in a safer way
            const claims = verifiedToken as any;

            // Try to find email in token claims
            let emailClaim =
                claims.email ||
                claims.primary_email_address ||
                claims.email_address ||
                (claims.emails && claims.emails[0]);

            // Fallback: If email missing in token, fetch full user from Clerk
            if (!emailClaim && claims.sub) {
                try {
                    const clerkUser = await clerkClient.users.getUser(claims.sub);
                    emailClaim = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)?.emailAddress || clerkUser.emailAddresses[0]?.emailAddress;
                    this.logger.log(`Fetched email from Clerk API: ${emailClaim}`);
                } catch (fetchErr) {
                    this.logger.error(`Failed to fetch user ${claims.sub} from Clerk`, fetchErr);
                }
            }

            let dbUser: any = null;

            if (emailClaim) {
                dbUser = await this.prisma.users.findUnique({
                    where: { email: emailClaim },
                });

                if (!dbUser) {
                    // Determine Role
                    // Check metadata or default to 'parent' or 'student'
                    // Safely access metadata if present
                    const role = (claims.metadata?.role as string) || (claims.public_metadata?.role as string) || 'student';

                    this.logger.log(`Creating new user for ${emailClaim} with role ${role}`);

                    dbUser = await this.prisma.users.create({
                        data: {
                            email: emailClaim,
                            role: role,
                            // Try to get name
                            first_name: claims.first_name || claims.given_name || 'New',
                            last_name: claims.last_name || claims.family_name || 'User',
                            password_hash: 'clerk_auth', // Dummy value or null
                            email_verified: true,
                        },
                    });
                } else {
                    // Sync Role if changed in Clerk
                    const tokenRole = (claims.metadata?.role as string) || (claims.public_metadata?.role as string);
                    // Also sync name if "New User"
                    const firstName = claims.first_name || claims.given_name;
                    const lastName = claims.last_name || claims.family_name;

                    if (tokenRole && tokenRole !== dbUser.role) {
                        // CRITICAL: Do not downgrade admins based on Clerk metadata
                        // Admins must be managed manually in the database or via specific admin tools.
                        if (dbUser.role === 'admin') {
                            this.logger.warn(`Ignored role update for ADMIN ${emailClaim}. Clerk says: ${tokenRole}, DB says: admin`);
                        } else {
                            this.logger.log(`Syncing role for ${emailClaim}: ${dbUser.role} -> ${tokenRole}`);
                            dbUser = await this.prisma.users.update({
                                where: { id: dbUser.id },
                                data: { role: tokenRole }
                            });
                        }
                    }

                    // Optional: Sync name if it was placeholder
                    if (firstName && dbUser.first_name === 'New' && firstName !== 'New') {
                        dbUser = await this.prisma.users.update({
                            where: { id: dbUser.id },
                            data: { first_name: firstName, last_name: lastName || dbUser.last_name }
                        });
                    }
                }
            } else {
                this.logger.warn('Token verified but no email found. Cannot map to DB user.');
                // Fallback: If we really can't get an email, we might fail or allow partial access
                throw new UnauthorizedException('Token missing email claim');
            }

            if (dbUser) {
                // Attach local DB user info to request
                // Map it to what JwtStrategy used to provide: { userId, email, role }
                const userObj = {
                    userId: dbUser.id,
                    email: dbUser.email,
                    role: dbUser.role,
                    clerkId: verifiedToken.sub,
                    ...dbUser
                };
                request.user = userObj;
                return true;
            }

            throw new UnauthorizedException('User not found and could not be created');

        } catch (err) {
            this.logger.error('Token verification failed', err);
            throw new UnauthorizedException('Invalid token');
        }
    }
}
