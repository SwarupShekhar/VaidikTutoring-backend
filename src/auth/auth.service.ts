import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata';
import { CreditsService } from '../credits/credits.service';
import { TutorsService } from '../tutors/tutors.service';
import * as crypto from 'crypto';
import { SlackService } from '../slack/slack.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private emailService: EmailService,
    private syncClerkService: SyncClerkMetadataService,
    private creditsService: CreditsService,
    private slackService: SlackService,
    @Inject(forwardRef(() => TutorsService))
    @Optional()
    private tutorsService?: TutorsService,
  ) { }

  private async logAudit(action: string, userId: string | null, details: any = {}) {
    try {
      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: userId,
          action,
          details,
        },
      });
    } catch (e) {
      this.logger.error('Failed to log audit', e);
    }
  }

  private async checkRateLimit(action: string, identifier: { userId?: string; ip?: string }, limit: number) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const where: any = {
      action,
      created_at: { gt: oneHourAgo },
    };

    if (identifier.userId) {
      where.actor_user_id = identifier.userId;
    } else if (identifier.ip) {
      // Assuming details is stored as simple JSON object
      where.details = {
        path: ['ip'],
        equals: identifier.ip,
      };
    }

    const count = await this.prisma.audit_logs.count({ where });
    if (count >= limit) {
      throw new BadRequestException('Too many requests. Please try again later.'); // 429 ideal, but BadRequest is standard here
    }
  }

  async signup(data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    role: string;
    grade?: number;
    ip?: string;
  }) {
    if (data.role !== 'parent' && data.role !== 'student') {
      throw new BadRequestException('Invalid role for public signup. Tutors must be created by Admin.');
    }

    if (data.ip) {
      await this.checkRateLimit('USER_SIGNED_UP_UNVERIFIED', { ip: data.ip }, 5);
    }

    const exists = await this.prisma.users.findUnique({
      where: { email: data.email },
    });

    if (exists) throw new ConflictException('User already exists');

    const hash = await bcrypt.hash(data.password, 10);
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await this.prisma.users.create({
      data: {
        email: data.email,
        password_hash: hash,
        first_name: data.first_name,
        last_name: data.last_name,
        role: data.role,
        email_verified: false,
        email_verification_token: token,
        email_verification_expires: expires,
      },
    });

    await this.logAudit('USER_SIGNED_UP_UNVERIFIED', user.id, { ip: data.ip });

    if (data.role === 'student' && data.grade) {
      const studentRecord = await this.prisma.students.create({
        data: {
          user_id: user.id,
          grade: data.grade.toString(),
          first_name: data.first_name,
          last_name: data.last_name,
        }
      });

      try {
        await this.creditsService.initTrialCredits(studentRecord.id);
      } catch (e) {
        this.logger.error('Failed to initialize trial credits', e);
      }
    }

    try {
      await this.emailService.sendVerificationEmail(user.email, token);
    } catch (e) {
      this.logger.error('Failed to send verification email', e);
    }

    this.slackService.sendAlert(`New signup: ${user.email} joined as a ${user.role}!`);

    return {
      message: 'Signup successful. Please check your email to verify your account.',
    };
  }

  async verifyEmail(token: string) {
    // 1. Check if token belongs to an ALREADY verified user?
    // Tokens are cleared on verification. Logic below finds by token.
    // IF user verified, token is null. So findFirst(token) returns null.
    // BUT we want to support "click link twice".
    // We can't identify the user from the token if the token is gone.
    // UNLESS we don't clear the token?
    // OR we can't support idempotency if we deleted the identifier.
    // Alternatively, if token is invalid, we say "Invalid or token expired OR already verified".
    // Ideally, frontend handles this: "If you are already verified, just login".
    // But backend idempotency requires finding the user.
    // If we can't find user by token, we can't say "success" safely without knowing if it was legitimate.
    // HACK/SOLUTION: Keep the token but mark it used? Or don't clear it?
    // Security risk: if token not cleared, can it be reused? NO, check 'email_verified' status.
    // If verified, ignore token expiry?
    // RECOMMENDED: When verifying, SET email_verified=true, but MAYBE kep the token or set a flag?
    // Or better: The user wants "if verified -> success".
    // But we look up by token. If token is gone, we fail.
    // We can only support this if we DO NOT clear the token immediately, OR if we accept that we can't support it fully unless we pass email? No.
    // Wait, the request says "if (user.email_verified)". This implies we FOUND the user.
    // Use case: User clicks link. We find user. Verified=true? Return success. Verified=false? Verify.
    // IF we clear token, next click -> user not found -> Error.
    // So to support this, we must NOT clear `email_verification_token` strictly, OR we accept that we can't support it fully unless we pass email? No.
    // Let's modify logic: Find user by token.
    // IF found:
    //    IF verified: Return success (Idempotent 1).
    //    ELSE: Verify, Clear Token? NO, if we clear token, 3rd click fails.
    //    If we want TRUE idempotency on the LINK, the token must remain valid-ish.
    //    BUT `email_verification_expires` handles validity.
    //    Let's keep the token but set verified=true.
    //    AND in `resend`, we overwrite it.
    //    Risk: Token leak allows... nothing, because verified=true blocks re-verification (no-op).
    //    Login? Token doesn't help login.
    //    So it is SAFE to keep the token until it expires or is overwritten.

    // Updated Logic:
    // 1. Find user by token (even if verified).
    // 2. If not found -> Error (Expired or Invalid).
    // 3. If found:
    //    a. If verified -> Return Success (Idempotent).
    //    b. If not verified -> Check Expiry.
    //       i. Expired -> Error.
    //       ii. Valid -> Verify, Log, Return Success. (Keep token).

    const user = await this.prisma.users.findFirst({
      where: {
        email_verification_token: token,
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired token');
    }

    if (user.email_verified) {
      return { success: true, message: 'Email already verified' };
    }

    if (user.email_verification_expires && user.email_verification_expires < new Date()) {
      throw new BadRequestException('Token expired');
    }

    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        email_verified: true,
        // email_verification_token: null, // Don't clear to allow Idempotency on link clicks
        // email_verification_expires: null,
      },
    });

    await this.logAudit('EMAIL_VERIFIED', user.id);

    return { success: true, message: 'Email verified successfully' };
  }

  async resendVerification(userId: string) {
    await this.checkRateLimit('VERIFICATION_RESENT', { userId }, 3);

    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.email_verified) throw new BadRequestException('Email already verified');

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.users.update({
      where: { id: userId },
      data: {
        email_verification_token: token,
        email_verification_expires: expires,
      }
    });

    await this.emailService.sendVerificationEmail(user.email, token);

    await this.logAudit('VERIFICATION_RESENT', user.id);

    return { message: 'Verification email sent' };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.users.findUnique({ where: { email } });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) throw new UnauthorizedException('Invalid password');

    // Update last_login_at
    await this.prisma.users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    // Update tutor's last_seen timestamp for online status tracking
    if (user.role === 'tutor' && this.tutorsService) {
      this.tutorsService.updateLastSeen(user.id).catch(err =>
        this.logger.warn(`Failed to update tutor last_seen on login: ${err.message}`)
      );
    }

    // Audit Log for Activity Pulse
    try {
      await this.prisma.audit_logs.create({
        data: {
          action: 'USER_LOGGED_IN',
          actor_user_id: user.id,
          details: {
            email: user.email,
            role: user.role,
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim()
          }
        }
      });
    } catch (e) {
      this.logger.error('Failed to audit login', e);
    }

    const token = this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      email_verified: user.email_verified, // Add this to payload? Useful for frontend/guards without DB hit.
      force_password_change: user.force_password_change, // Crucial for PasswordChangeGuard
      tutor_status: user.tutor_status, // For TutorStatusGuard
    });

    this.slackService.sendAlert(`User signed in: ${email} (${user.role})`);

    return {
      message: 'Login successful',
      token,
      user,
    };
  }

  /**
   * Sliding-session refresh. Re-issues a fresh JWT for a user who presents a
   * still-valid token (the route is JwtAuthGuard-protected, so an expired token
   * is rejected before it reaches here). Keeps an active session from expiring
   * mid-use without any refresh-token infrastructure. Claims are re-emitted from
   * the verified token payload (req.user).
   */
  refreshToken(user: any) {
    const token = this.jwt.sign({
      sub: user.userId,
      email: user.email,
      role: user.role,
      email_verified: user.email_verified,
      phone_verified: user.phone_verified,
      force_password_change: user.force_password_change,
      tutor_status: user.tutor_status,
    });
    return { token };
  }
  async acceptTutorInvite(token: string, password: string) {
    // 1. Find user by invite token
    const user = await this.prisma.users.findFirst({
      where: { tutor_invite_token: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired invite token');
    }

    // 2. Check expiry
    if (user.tutor_invite_expires && user.tutor_invite_expires < new Date()) {
      throw new BadRequestException('Invite token expired');
    }

    // 3. Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // 4. Update user: Set password, Verify Email, Clear Token
    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        password_hash,
        email_verified: true, // Auto-verify email
        tutor_invite_token: null,
        tutor_invite_expires: null,
        is_active: true, // Ensure active
      },
    });

    await this.logAudit('TUTOR_ACCEPTED_INVITE', user.id);

    return { message: 'Invite accepted. You can now login.' };
  }

  async changePassword(userId: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    const hash = await bcrypt.hash(newPassword, 10);

    const updatedUser = await this.prisma.users.update({
      where: { id: userId },
      data: {
        password_hash: hash,
        force_password_change: false, // Turn off force flag
      },
    });

    await this.logAudit('USER_CHANGED_PASSWORD', userId);

    // Return new token immediately so frontend can update state without re-login
    const token = this.jwt.sign({
      sub: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      email_verified: updatedUser.email_verified,
      force_password_change: false,
    });

    return { message: 'Password changed successfully', token };
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) return null;

    // Check if user has real history to prevent onboarding traps
    const [ownStudentProfileCount, existingChildrenCount, paidPurchasesCount] = await Promise.all([
      this.prisma.students.count({ where: { user_id: userId } }),
      this.prisma.students.count({ where: { parent_user_id: userId } }),
      this.prisma.purchases.count({ where: { user_id: userId, status: 'PAID' } })
    ]);
    const has_onboarded_history = ownStudentProfileCount > 0 || existingChildrenCount > 0 || paidPurchasesCount > 0;

    this.logger.debug(`User profile requested: ${userId} role=${user.role}`);

    // return safe user object (exclude password hash)
    // We can use a mapper or just return what we need + spread
    const { password_hash, email_verification_token, ...safeUser } = user;
    return { ...safeUser, has_onboarded_history };
  }

  /**
   * Persist the role chosen during onboarding to the DB (authoritative) and Clerk
   * metadata, so middleware no longer has to guess. Fires a welcome email the
   * first time a role is set (status still 'not_started').
   */
  async updateRole(userId: string, role: string) {
    if (role !== 'parent' && role !== 'student') {
      throw new BadRequestException('Role must be parent or student');
    }

    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    // Never let onboarding downgrade a privileged account.
    if (user.role === 'admin' || user.role === 'tutor') {
      this.logger.warn(
        `ROLE_CHANGE_AUDIT: userId=${userId} previousRole=${user.role} requestedRole=${role} outcome=rejected:privileged_role_protected timestamp=${new Date().toISOString()}`,
      );
      return this.getUserProfile(userId);
    }

    // Never let the onboarding role-picker silently overwrite an account that
    // already has real history under the OTHER role. This destroyed a live paid
    // student's account by flipping it to 'parent' (Jul 3 2026 incident) — the
    // frontend's "is this a fresh signup" check trusted onboarding_status alone,
    // which was stale for this legacy account even though the role was real. This
    // is the actual mutation, so it's the right place for the hard stop: a genuine
    // role conversion for an established account is an admin action, not a picker
    // click, regardless of what the frontend thinks it knows.
    const [ownStudentProfile, existingChildrenCount, paidPurchasesCount] = await Promise.all([
      this.prisma.students.findUnique({ where: { user_id: userId } }),
      this.prisma.students.count({ where: { parent_user_id: userId } }),
      this.prisma.purchases.count({ where: { user_id: userId, status: 'PAID' } })
    ]);
    if (role === 'parent' && ownStudentProfile) {
      this.logger.warn(
        `ROLE_CHANGE_AUDIT: userId=${userId} previousRole=${user.role} requestedRole=${role} outcome=rejected:parent_has_student_profile timestamp=${new Date().toISOString()}`,
      );
      throw new BadRequestException(
        'This account already has a student profile and cannot self-convert to a parent account. Contact support.',
      );
    }
    if (role === 'parent' && paidPurchasesCount > 0) {
      this.logger.warn(
        `ROLE_CHANGE_AUDIT: userId=${userId} previousRole=${user.role} requestedRole=${role} outcome=rejected:parent_has_paid_history timestamp=${new Date().toISOString()}`,
      );
      throw new BadRequestException(
        'This account has purchase history and cannot self-convert to a parent account. Contact support.',
      );
    }
    if (role === 'student' && existingChildrenCount > 0) {
      this.logger.warn(
        `ROLE_CHANGE_AUDIT: userId=${userId} previousRole=${user.role} requestedRole=${role} outcome=rejected:student_has_children timestamp=${new Date().toISOString()}`,
      );
      throw new BadRequestException(
        'This account already manages one or more children and cannot self-convert to a student account. Contact support.',
      );
    }

    // Updates both Clerk publicMetadata and the DB role.
    await this.syncClerkService.syncUserRoleToClerk(userId, role).catch((err) =>
      this.logger.error(`[updateRole] Clerk sync failed for ${userId}: ${err.message}`),
    );

    await this.prisma.users.update({
      where: { id: userId },
      data: { role, onboarding_status: 'in_progress' },
    });

    this.logger.warn(
      `ROLE_CHANGE_AUDIT: userId=${userId} previousRole=${user.role} requestedRole=${role} outcome=allowed timestamp=${new Date().toISOString()}`,
    );

    // Welcome email now fires at account creation (ClerkAuthGuard), not here.

    return this.getUserProfile(userId);
  }

  // Emergency: Fix admin role for specific email
  async fixAdminRole(email: string) {
    this.logger.log(`Attempting to fix admin role for: ${email}`);
    
    const user = await this.prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (email === 'swarupshekhar.vaidikedu@gmail.com') {
      // Force admin role for this specific email
      const updatedUser = await this.prisma.users.update({
        where: { id: user.id },
        data: { role: 'admin' }
      });

      // Also sync to Clerk permanently
      try {
        await this.syncClerkService.syncUserRoleToClerk(updatedUser.id, 'admin');
        this.logger.log(`Permanently synced admin role to Clerk for: ${email}`);
      } catch (err) {
        this.logger.error('Clerk sync failed, but DB updated', err);
      }

      this.logger.log(`Fixed admin role for: ${email}`);
      await this.logAudit('ADMIN_ROLE_FIXED', user.id, { email, previousRole: user.role, newRole: 'admin' });

      return {
        message: 'Admin role fixed and permanently synced to Clerk',
        user: updatedUser
      };
    }

    throw new BadRequestException('Admin role fix not authorized for this email');
  }
}

