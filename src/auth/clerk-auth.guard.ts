
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verifyToken, clerkClient } from '@clerk/clerk-sdk-node';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
    private readonly logger = new Logger(ClerkAuthGuard.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token = request.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            console.log('ClerkAuthGuard: No token provided');
            this.logger.warn('No token provided');
            throw new UnauthorizedException('No token provided');
        }
        console.log('ClerkAuthGuard: Verifying token:', token.substring(0, 10) + '...');

        let claims: any;
        let isClerk = false;

        try {
            // 1. Try Clerk Verification
            try {
                const verifiedToken = await verifyToken(token, {
                    secretKey: process.env.CLERK_SECRET_KEY,
                    clockSkewInMs: 60000, // 60s leeway
                } as any);
                claims = verifiedToken;
                isClerk = true;
            } catch (clerkErr) {
                // 2. Fallback: Try Custom JWT Verification
                try {
                    claims = this.jwtService.verify(token);
                    isClerk = false;
                } catch (jwtErr) {
                    this.logger.error(`ClerkAuthGuard: Token verification failed for both Clerk and JWT.`);
                    this.logger.error(`Clerk Error: ${clerkErr.message}`);
                    this.logger.error(`JWT Error: ${jwtErr.message}`);
                    throw new UnauthorizedException('Invalid token');
                }
            }

            // Map Claims to Email
            let emailClaim =
                claims.email ||
                claims.primary_email_address ||
                claims.email_address ||
                (claims.emails && claims.emails[0]);

            // Fallback: If email missing in token, fetch full user from Clerk (If sub looks like clerk id?)
            if (!emailClaim && claims.sub && typeof claims.sub === 'string' && claims.sub.startsWith('user_')) {
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
                    // Create User if not found (Only for Clerk tokens? Or both? Both seems safe if email is verified)
                    // Custom tokens from 'login' implies user exists, but if we deleted user... 
                    // This auto-creation logic is primarily for Clerk syncing.

                    const role = (claims.metadata?.role as string) || (claims.public_metadata?.role as string) || claims.role || 'student';

                    const fallbackFirstName = emailClaim.split('@')[0];
                    this.logger.log(`Creating new user for ${emailClaim} with role ${role}`);

                    dbUser = await this.prisma.users.create({
                        data: {
                            email: emailClaim,
                            role: role,
                            first_name: claims.first_name || claims.given_name || fallbackFirstName,
                            last_name: claims.last_name || claims.family_name || '',
                            password_hash: 'clerk_auth', // Dummy value
                            email_verified: true, // Auto-verify if authenticated via Clerk/JWT
                        },
                    });
                } else {
                    // Sync Role if changed in Clerk
                    const tokenRole = (claims.metadata?.role as string) || (claims.public_metadata?.role as string);
                    const firstName = claims.first_name || claims.given_name;
                    const lastName = claims.last_name || claims.family_name;

                    if (tokenRole && tokenRole !== dbUser.role) {
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

                    // Auto-verify email if not verified but valid Clerk token present
                    if (dbUser.email_verified === false) {
                        this.logger.log(`Auto-verifying user ${emailClaim} from Clerk token`);
                        dbUser = await this.prisma.users.update({
                            where: { id: dbUser.id },
                            data: { email_verified: true }
                        });
                    }

                    if (firstName && dbUser.first_name === 'New' && firstName !== 'New') {
                        dbUser = await this.prisma.users.update({
                            where: { id: dbUser.id },
                            data: { first_name: firstName, last_name: lastName || dbUser.last_name }
                        });

                        // Also sync to STUDENTS table if this user is a student
                        // This fixes the "New User" issue in sessions
                        if (dbUser.role === 'student') {
                            await this.prisma.students.updateMany({
                                where: { user_id: dbUser.id },
                                data: { first_name: firstName, last_name: lastName || dbUser.last_name }
                            });
                            this.logger.log(`Synced student profile name for ${emailClaim}`);
                        }
                    }
                }
            } else {
                // If Custom Token has userId but no email? Custom tokens usually have email.
                // If Clerk token has no email? Error.
                if (isClerk) {
                    this.logger.warn('Token verified but no email found. Cannot map to DB user.');
                    throw new UnauthorizedException('Token missing email claim');
                }
                // For Custom Token, usually we trust 'sub' as userId?
                // But existing logic relies on email to find/sync.
                // If custom token fails to provide email, we fail.
            }

            if (dbUser) {
                // Log final detected role for debugging 401/403s
                this.logger.log(`[ClerkAuthGuard] Authorized: ${dbUser.email} (Role: ${dbUser.role})`);

                const userObj = {
                    userId: dbUser.id,
                    email: dbUser.email,
                    role: dbUser.role,
                    clerkId: isClerk ? claims.sub : undefined,
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
