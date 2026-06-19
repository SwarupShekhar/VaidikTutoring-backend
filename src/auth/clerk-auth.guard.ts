
import { CanActivate, ExecutionContext, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { verifyToken, clerkClient } from '@clerk/clerk-sdk-node';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata';
import { EmailService } from '../email/email.service';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
    private readonly logger = new Logger(ClerkAuthGuard.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly syncClerkService: SyncClerkMetadataService,
        // Optional so the JwtAuthGuard subclass (3-arg super) still constructs.
        // Welcome emails fire on the real Clerk login path, where DI supplies this.
        @Optional() private readonly email?: EmailService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization || '';
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const path = request.url;

        if (!token || token === 'undefined' || token === 'null') {
            this.logger.warn(`ClerkAuthGuard: No token provided for ${path}`);
            throw new UnauthorizedException('No token provided or invalid bearer format');
        }

        let claims: any;
        let isClerk = false;

        try {
            // 1. Detection Strategy: If it looks like our structured JWT or if Clerk fails
            // Clerk tokens usually have a specific header structure or presence of 'clerk' strings
            
            // Try Clerk first as it is the primary auth
            try {
                // Using clerkClient.verifyToken (Clerk SDK v4)
                claims = await (clerkClient as any).verifyToken(token);
                isClerk = true;
                this.logger.debug(`ClerkAuthGuard: Token verified via Clerk for ${path}`);
            } catch (clerkErr) {
                // 2. Fallback: Try Custom JWT Verification
                try {
                    claims = this.jwtService.verify(token);
                    isClerk = false;
                    this.logger.debug(`ClerkAuthGuard: Token verified via JWT Fallback for ${path}`);
                } catch (jwtErr) {
                    this.logger.error(`ClerkAuthGuard Auth Fail [${path}]: Clerk(${clerkErr.message}), JWT(${jwtErr.message})`);
                    throw new UnauthorizedException(`Invalid session. Please login again. Details: Clerk(${clerkErr.message.slice(0, 30)}), JWT(${jwtErr.message.slice(0, 30)})`);
                }
            }

            // Map Claims to Email
            let emailClaim =
                claims.email ||
                claims.primary_email_address ||
                claims.email_address ||
                (claims.emails && claims.emails[0]);

            // Fallback: fetch from Clerk API if missing
            if (!emailClaim && claims.sub && typeof claims.sub === 'string' && claims.sub.startsWith('user_')) {
                try {
                    const clerkUser = await clerkClient.users.getUser(claims.sub);
                    emailClaim = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)?.emailAddress || clerkUser.emailAddresses[0]?.emailAddress;
                } catch (fetchErr) {
                    this.logger.error(`Failed to fetch user ${claims.sub} from Clerk`, fetchErr);
                }
            }

            let dbUser: any = null;

            if (!isClerk && claims.sub) {
                // For local JWTs, claims.sub is the exact user UUID
                dbUser = await this.prisma.users.findUnique({
                    where: { id: claims.sub }
                });
            }

            if (!dbUser && emailClaim) {
                dbUser = await this.prisma.users.findFirst({
                    where: { email: { equals: emailClaim, mode: 'insensitive' } },
                    orderBy: { created_at: 'asc' },
                });
            }

            // Create user if they don't exist in DB at all and we have email
            if (!dbUser && emailClaim) {
                    const role = (claims.metadata?.role as string) || (claims.public_metadata?.role as string) || claims.role || 'student';
                    const fallbackFirstName = emailClaim.split('@')[0];
                    this.logger.log(`Creating new user for ${emailClaim} with role ${role}`);

                    // Only mark email verified if Clerk explicitly confirms it
                    const clerkEmailVerified = claims.email_verified === true ||
                        (claims.primary_email_address_id && claims.email_addresses?.find(
                            (e: any) => e.id === claims.primary_email_address_id
                        )?.verification?.status === 'verified');

                    const leadInfo = await this.prisma.leadCapture.findFirst({
                        where: { email: emailClaim },
                        orderBy: { created_at: 'desc' }
                    });

                    dbUser = await this.prisma.users.create({
                        data: {
                            email: emailClaim,
                            role: emailClaim === 'swarupshekhar.vaidikedu@gmail.com' ? 'admin' : role,
                            first_name: claims.first_name || claims.given_name || fallbackFirstName,
                            last_name: claims.last_name || claims.family_name || '',
                            password_hash: 'clerk_auth',
                            email_verified: !!clerkEmailVerified,
                            lead_source: leadInfo?.source || null,
                            onboarding_status: 'not_started',
                        },
                    });

                    // Mark new Clerk users as needing phone verification (fire-and-forget)
                    if (dbUser.role === 'parent' || dbUser.role === 'student') {
                        this.syncClerkService.syncPhoneVerifiedToClerk(dbUser.id, false).catch(err =>
                            this.logger.error(`[ClerkAuthGuard] Failed to set phone_verified:false for new user: ${err.message}`)
                        );

                        // Fire the welcome email + log it. Strictly fire-and-forget —
                        // must never block or fail authentication.
                        if (this.email) {
                            this.email
                                .sendWelcomeEmail(dbUser.email, dbUser.id, dbUser.first_name || undefined, dbUser.lead_source)
                                .catch(err =>
                                    this.logger.error(`[ClerkAuthGuard] Welcome email failed for new user: ${err.message}`)
                                );
                            this.prisma.email_events
                                .createMany({ data: [{ user_id: dbUser.id, type: 'welcome' }], skipDuplicates: true })
                                .catch(err =>
                                    this.logger.error(`[ClerkAuthGuard] Failed to log welcome email_event: ${err.message}`)
                                );
                        }
                    }
                } else {
                    // Sync Name/Role/Verification
                    const tokenRole = (claims.metadata?.role as string) || (claims.public_metadata?.role as string);
                    const firstName = claims.first_name || claims.given_name;
                    const lastName = claims.last_name || claims.family_name;

                    if (dbUser.email === 'swarupshekhar.vaidikedu@gmail.com' && dbUser.role !== 'admin') {
                        dbUser = await this.prisma.users.update({
                            where: { id: dbUser.id },
                            data: { role: 'admin' }
                        });
                        this.logger.log(`Forced admin role for ${dbUser.email}`);
                    } else if (tokenRole && tokenRole !== dbUser.role && dbUser.role !== 'admin') {
                        dbUser = await this.prisma.users.update({
                            where: { id: dbUser.id },
                            data: { role: tokenRole }
                        });
                    }

                    if (dbUser.email_verified === false) {
                        dbUser = await this.prisma.users.update({ where: { id: dbUser.id }, data: { email_verified: true } });
                    }

                    // Sync phone verification status to Clerk if not verified in DB
                    if (dbUser.phone_verified === false && (dbUser.role === 'parent' || dbUser.role === 'student')) {
                        this.syncClerkService.syncPhoneVerifiedToClerk(dbUser.id, false).catch(err =>
                            this.logger.error(`[ClerkAuthGuard] Failed to set phone_verified:false for existing user: ${err.message}`)
                        );
                    }


                    if (firstName && dbUser.first_name === 'New' && firstName !== 'New') {
                        dbUser = await this.prisma.users.update({
                            where: { id: dbUser.id },
                            data: { first_name: firstName, last_name: lastName || dbUser.last_name }
                        });
                    }

                    // AUTO-LINK Student Profile
                    if (dbUser.role === 'student' || claims.role === 'student') {
                        const existingStudentProfile = await this.prisma.students.findFirst({
                            where: { email: emailClaim, user_id: null }
                        });

                        if (existingStudentProfile) {
                            this.logger.log(`Auto-linking existing student profile ${existingStudentProfile.id} for ${emailClaim}`);
                            await this.prisma.students.update({
                                where: { id: existingStudentProfile.id },
                                data: { user_id: dbUser.id, first_name: firstName || dbUser.first_name, last_name: lastName || dbUser.last_name }
                            });
                        } else {
                            const linkedProfile = await this.prisma.students.findUnique({ where: { user_id: dbUser.id } });
                            if (!linkedProfile) {
                                await this.prisma.students.create({
                                    data: {
                                        user_id: dbUser.id,
                                        email: emailClaim,
                                        first_name: firstName || dbUser.first_name || 'Student',
                                        last_name: lastName || dbUser.last_name || '',
                                        grade: 'TBD'
                                    }
                                });
                            } else if (firstName && linkedProfile.first_name !== firstName) {
                                await this.prisma.students.update({
                                    where: { id: linkedProfile.id },
                                    data: { first_name: firstName, last_name: lastName || linkedProfile.last_name }
                                });
                            }
                        }
                    }
                }
            } else {
                if (isClerk) {
                    this.logger.warn(`Token verified but no email found in claims for ${path}`);
                    throw new UnauthorizedException('Token missing email claim');
                }
                throw new UnauthorizedException('Missing email');
            }

            if (dbUser) {
                request.user = {
                    userId: dbUser.id,
                    email: dbUser.email,
                    role: dbUser.role,
                    ...dbUser
                };
                return true;
            }

            throw new UnauthorizedException('User profile sync failed');

        } catch (err) {
            this.logger.error(`ClerkAuthGuard Failure on ${path}: ${err.message}`);
            if (err instanceof UnauthorizedException) throw err;
            throw new UnauthorizedException(`Auth error: ${err.message}`);
        }
    }
}
