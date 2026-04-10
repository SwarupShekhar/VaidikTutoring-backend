import { Injectable, BadRequestException, Logger, ForbiddenException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export interface CreditStatus {
  mode: 'trial_active' | 'trial_exhausted' | 'trial_expired' | 'paid' | 'no_access' | 'learning';
  creditsRemaining: number;
  trialExpiresAt: string | null;
  daysLeft: number | null;
  sessionsUsed: number;
  canBook: boolean;
  plan: 'foundation' | 'mastery' | 'elite' | null;
}

export interface BookingCreditCost {
  cost: number;
  isFree: boolean;
  isTrialSession: boolean;
}

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── TRIAL CREDIT SYSTEM ───────────────────────────────────────────

  /**
   * Initialize trial credits for a newly created student.
   * Call this immediately after a student record is created during signup.
   */
  async initTrialCredits(studentId: string): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.students.update({
      where: { id: studentId },
      data: {
        trial_credits: 10,
        trial_started_at: now,
        trial_expires_at: expiresAt,
        trial_sessions_used: 0,
        is_trial_active: true,
      },
    });

    this.logger.log(`Initialized trial credits for student ${studentId}, expires ${expiresAt.toISOString()}`);
  }

  /**
   * Get the credit status for a student. Now async to check live booking counts.
   */
  async getCreditStatus(student: any): Promise<CreditStatus> {
    const now = new Date();

    // 1. Calculate live trial session usage from DB to ensure 100% accuracy
    const liveSessionsUsed = await this.prisma.bookings.count({
      where: {
        student_id: student.id,
        is_trial_session: true,
        status: { not: 'cancelled' },
      },
    });

    // 2. Check for Learning Mode Enrollment
    if (student.enrollment_status === 'learning') {
      const creditsRemaining = student.subscription_credits || 0;
      return {
        mode: 'learning',
        creditsRemaining,
        trialExpiresAt: null,
        daysLeft: null,
        sessionsUsed: liveSessionsUsed,
        canBook: creditsRemaining > 0,
        plan: student.subscription_plan as any,
      };
    }

    // 3. Check for paid subscription
    if (
      student.subscription_plan &&
      student.subscription_ends &&
      new Date(student.subscription_ends) > now
    ) {
      return {
        mode: 'paid',
        creditsRemaining: student.subscription_credits || 0,
        trialExpiresAt: null,
        daysLeft: null,
        sessionsUsed: liveSessionsUsed,
        canBook: (student.subscription_credits || 0) > 0,
        plan: student.subscription_plan as any,
      };
    }

    // 4. Check if trial session limit is reached (3 sessions max)
    if (liveSessionsUsed >= 3) {
      return {
        mode: 'trial_exhausted',
        creditsRemaining: Math.max(0, student.trial_credits || 0),
        trialExpiresAt: student.trial_expires_at?.toISOString() || null,
        daysLeft: student.trial_expires_at
          ? Math.max(0, Math.ceil((new Date(student.trial_expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
          : null,
        sessionsUsed: liveSessionsUsed,
        canBook: false,
        plan: null,
      };
    }

    // 5. Check if trial is expired
    if (
      !student.is_trial_active ||
      (student.trial_expires_at && new Date(student.trial_expires_at) < now)
    ) {
      return {
        mode: 'trial_expired',
        creditsRemaining: Math.max(0, student.trial_credits || 0),
        trialExpiresAt: student.trial_expires_at?.toISOString() || null,
        daysLeft: 0,
        sessionsUsed: liveSessionsUsed,
        canBook: false,
        plan: null,
      };
    }

    // 6. Check if trial credits are exhausted
    if ((student.trial_credits || 0) <= 0) {
      return {
        mode: 'trial_exhausted',
        creditsRemaining: 0,
        trialExpiresAt: student.trial_expires_at?.toISOString() || null,
        daysLeft: student.trial_expires_at
          ? Math.max(0, Math.ceil((new Date(student.trial_expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
          : null,
        sessionsUsed: liveSessionsUsed,
        canBook: false,
        plan: null,
      };
    }

    // 7. Trial is active
    const daysLeft = student.trial_expires_at
      ? Math.max(0, Math.ceil((new Date(student.trial_expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      : null;

    return {
      mode: 'trial_active',
      creditsRemaining: student.trial_credits || 0,
      trialExpiresAt: student.trial_expires_at?.toISOString() || null,
      daysLeft,
      sessionsUsed: liveSessionsUsed,
      canBook: true,
      plan: null,
    };
  }

  /**
   * Compute the credit cost for a booking.
   */
  computeBookingCreditCost(student: any): BookingCreditCost {
    const now = new Date();

    // Learning mode: deduct 1 subscription credit
    if (student.enrollment_status === 'learning') {
      return { cost: 1, isFree: false, isTrialSession: false };
    }

    // Paid plan
    if (
      student.subscription_plan &&
      student.subscription_ends &&
      new Date(student.subscription_ends) > now
    ) {
      return { cost: 1, isFree: false, isTrialSession: false };
    }

    // Trial: first session is free
    if ((student.trial_sessions_used || 0) === 0) {
      return { cost: 0, isFree: true, isTrialSession: true };
    }

    // Trial: subsequent sessions cost 5 credits
    return { cost: 5, isFree: false, isTrialSession: true };
  }

  /**
   * Deduct credits from a student. Uses row-level locking to prevent race conditions.
   */
  async deductCredits(studentId: string, cost: number, isTrial: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Row-level lock via SELECT ... FOR UPDATE (raw query)
      const rows: any[] = await tx.$queryRawUnsafe(
        `SELECT * FROM app.students WHERE id = $1 FOR UPDATE`,
        studentId,
      );

      if (!rows || rows.length === 0) {
        throw new BadRequestException('Student not found');
      }

      const student = rows[0];

      if (isTrial) {
        const newCredits = (student.trial_credits || 0) - cost;
        if (newCredits < 0) {
          throw new ForbiddenException('Insufficient trial credits');
        }

        const newSessionsUsed = (student.trial_sessions_used || 0) + 1;
        const shouldDeactivate = newCredits <= 0 || newSessionsUsed >= 3;

        await tx.students.update({
          where: { id: studentId },
          data: {
            trial_credits: newCredits,
            trial_sessions_used: newSessionsUsed,
            is_trial_active: !shouldDeactivate,
          },
        });
      } else {
        const newCredits = (student.subscription_credits || 0) - cost;
        if (newCredits < 0) {
          throw new ForbiddenException('Insufficient subscription credits');
        }

        await tx.students.update({
          where: { id: studentId },
          data: {
            subscription_credits: newCredits,
          },
        });
      }
    });

    this.logger.log(`Deducted ${cost} credits from student ${studentId} (isTrial: ${isTrial})`);
  }

  /**
   * Refund credits on cancellation. Only refunds if trial has not expired.
   */
  async refundCredits(studentId: string, cost: number, isTrialSession: boolean): Promise<void> {
    if (cost === 0) return;

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });

    if (!student) return;

    if (isTrialSession) {
      // Only refund trial credits if trial hasn't expired
      if (student.trial_expires_at && new Date(student.trial_expires_at) < new Date()) {
        this.logger.log(`Skipping trial refund for student ${studentId}: trial already expired`);
        return;
      }

      await this.prisma.students.update({
        where: { id: studentId },
        data: {
          trial_credits: (student.trial_credits || 0) + cost,
          trial_sessions_used: Math.max(0, (student.trial_sessions_used || 0) - 1),
          is_trial_active: true,
        },
      });
    } else {
      // Refund subscription credit
      await this.prisma.students.update({
        where: { id: studentId },
        data: {
          subscription_credits: (student.subscription_credits || 0) + cost,
        },
      });
    }

    this.logger.log(`Refunded ${cost} credits to student ${studentId} (trial: ${isTrialSession})`);
  }

  /**
   * Subscribe a student to a plan (stub — real payment integration later).
   */
  async subscribe(studentId: string, plan: 'foundation' | 'mastery' | 'elite'): Promise<CreditStatus> {
    const creditMap = { foundation: 8, mastery: 16, elite: 24 };
    const credits = creditMap[plan];

    if (!credits) {
      throw new BadRequestException('Invalid plan');
    }

    const now = new Date();
    const ends = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // TODO: payment gate here — integrate Stripe/Razorpay before DB write

    const updated = await this.prisma.students.update({
      where: { id: studentId },
      data: {
        subscription_plan: plan,
        subscription_credits: credits,
        subscription_starts: now,
        subscription_ends: ends,
        is_trial_active: false, // trial ends when subscription starts
        enrollment_status: 'learning', // Move to learning mode
      },
    });

    this.logger.log(`Student ${studentId} subscribed to ${plan} plan with ${credits} credits`);

    return await this.getCreditStatus(updated);
  }

  /**
   * Admin: Grant credits to a student with an audit note.
   */
  async adminGrantCredits(
    studentId: string,
    credits: number,
    note: string,
    grantedByUserId: string,
  ): Promise<void> {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new BadRequestException('Student not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Add credits to trial balance
      await tx.students.update({
        where: { id: studentId },
        data: {
          trial_credits: (student.trial_credits || 0) + credits,
          is_trial_active: true,
        },
      });

      // Log in credit_adjustments
      await tx.credit_adjustments.create({
        data: {
          student_id: studentId,
          amount: credits,
          note,
          granted_by: grantedByUserId,
        },
      });
    });

    this.logger.log(`Admin ${grantedByUserId} granted ${credits} credits to student ${studentId}: ${note}`);
  }

  /**
   * Cron: Expire stale trials (run naturally at midnight).
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expireStaleTrials(): Promise<number> {
    const result = await this.prisma.students.updateMany({
      where: {
        is_trial_active: true,
        trial_expires_at: { lt: new Date() },
      },
      data: {
        is_trial_active: false,
      },
    });

    this.logger.log(`Expired ${result.count} stale trial(s)`);
    return result.count;
  }

  // ─── EXISTING CREDIT SYSTEM (subscription-based) ─────────────────

  /**
   * Grant credits to user after successful payment
   */
  async grantCredits(userId: string, packageId: string): Promise<void> {
    const pkg = await this.prisma.packages.findUnique({
      where: { id: packageId },
    });

    if (!pkg || !pkg.active) {
      throw new BadRequestException('Package not found or inactive');
    }

    const creditsTotal = this.calculateCreditsFromPackage(pkg);

    const existingCredits = await this.prisma.user_credits.findFirst({
      where: { 
        user_id: userId,
        reset_date: new Date(),
      },
    });

    if (existingCredits) {
      await this.prisma.user_credits.update({
        where: { id: existingCredits.id },
        data: {
          credits_total: existingCredits.credits_total + creditsTotal,
          updated_at: new Date(),
        },
      });
    } else {
      await this.prisma.user_credits.create({
        data: {
          user_id: userId,
          package_id: packageId,
          credits_total: creditsTotal,
          reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }

    this.logger.log(`Granted ${creditsTotal} credits to user ${userId} for package ${packageId}`);

    // Derive plan name from package for the new subscription system
    const pkgName = pkg.name.toLowerCase();
    const planName = pkgName.includes('elite') ? 'elite' : pkgName.includes('mastery') ? 'mastery' : 'foundation';
    const subEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Post-payment Enrollment Sync — updates BOTH the legacy sessions_remaining
    // field AND the new subscription credit fields used by getCreditStatus()
    await this.prisma.students.updateMany({
      where: { user_id: userId },
      data: {
        enrollment_status: 'learning',
        sessions_remaining: { increment: creditsTotal },
        package_end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        // New credit system fields — these are what BookingsService reads
        subscription_plan: planName,
        subscription_credits: { increment: creditsTotal },
        subscription_starts: new Date(),
        subscription_ends: subEnds,
        is_trial_active: false,
      },
    });
  }

  async checkCredits(userId: string): Promise<{ hasCredits: boolean; creditsRemaining: number }> {
    const userCredits = await this.prisma.user_credits.findFirst({
      where: { 
        user_id: userId,
        reset_date: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!userCredits) {
      return { hasCredits: false, creditsRemaining: 0 };
    }

    const creditsRemaining = userCredits.credits_total - userCredits.credits_used;
    return {
      hasCredits: creditsRemaining > 0,
      creditsRemaining: Math.max(0, creditsRemaining),
    };
  }

  async consumeCredits(userId: string, sessionId: string, credits: number = 1): Promise<void> {
    const { hasCredits } = await this.checkCredits(userId);
    
    if (!hasCredits) {
      throw new ForbiddenException('Insufficient credits for session');
    }

    const userCredits = await this.prisma.user_credits.findFirst({
      where: { 
        user_id: userId,
        reset_date: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!userCredits) {
      throw new BadRequestException('No active credit subscription found');
    }

    await this.prisma.user_credits.update({
      where: { id: userCredits.id },
      data: {
        credits_used: userCredits.credits_used + credits,
        updated_at: new Date(),
      },
    });

    await this.prisma.credit_usage_logs.create({
      data: {
        user_id: userId,
        session_id: sessionId,
        credits_used: credits,
        notes: `Session completed - ${credits} credit(s) consumed`,
      },
    });

    this.logger.log(`Consumed ${credits} credits from user ${userId} for session ${sessionId}`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetExpiredCredits(): Promise<void> {
    const expiredCredits = await this.prisma.user_credits.findMany({
      where: {
        reset_date: { lte: new Date() },
      },
    });

    for (const credit of expiredCredits) {
      await this.prisma.user_credits.update({
        where: { id: credit.id },
        data: {
          reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          credits_total: 0,
          credits_used: 0,
          updated_at: new Date(),
        },
      });

      this.logger.log(`Reset credits for user ${credit.user_id}`);
    }
  }

  async getUserCreditStatus(userId: string) {
    const userCredits = await this.prisma.user_credits.findFirst({
      where: { 
        user_id: userId,
        reset_date: { gt: new Date() },
      },
      include: {
        packages: true,
      },
      orderBy: { created_at: 'desc' },
    });

    if (!userCredits) {
      return {
        hasSubscription: false,
        creditsTotal: 0,
        creditsUsed: 0,
        creditsRemaining: 0,
        resetDate: null,
        package: null,
      };
    }

    const creditsRemaining = userCredits.credits_total - userCredits.credits_used;

    return {
      hasSubscription: true,
      creditsTotal: userCredits.credits_total,
      creditsUsed: userCredits.credits_used,
      creditsRemaining: Math.max(0, creditsRemaining),
      resetDate: userCredits.reset_date,
      package: userCredits.packages,
    };
  }

  private calculateCreditsFromPackage(pkg: any): number {
    const name = pkg.name.toLowerCase();
    
    if (name.includes('foundation')) return 8;
    if (name.includes('mastery')) return 16;
    if (name.includes('elite')) return 24;
    
    return 8;
  }
}
