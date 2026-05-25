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
      const subscriptionExpired = student.subscription_ends && new Date(student.subscription_ends) < now;
      return {
        mode: subscriptionExpired ? 'trial_expired' : 'learning', // using trial_expired to prompt renew
        creditsRemaining: subscriptionExpired ? 0 : creditsRemaining,
        trialExpiresAt: null,
        daysLeft: null,
        sessionsUsed: liveSessionsUsed,
        canBook: creditsRemaining > 0 && !subscriptionExpired,
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
            // Keep legacy sessions_remaining in sync so the profile page shows the
            // correct number instead of the stale value written at purchase time.
            sessions_remaining: Math.max(0, (student.sessions_remaining || 0) - cost),
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
      // Refund subscription credit — also restore sessions_remaining (legacy field)
      await this.prisma.students.update({
        where: { id: studentId },
        data: {
          subscription_credits: (student.subscription_credits || 0) + cost,
          sessions_remaining: (student.sessions_remaining || 0) + cost,
        },
      });
    }

    this.logger.log(`Refunded ${cost} credits to student ${studentId} (trial: ${isTrialSession})`);
  }

  /**
   * Subscribe a student to a plan after payment verification.
   * Internal-only method — all public calls must go through PaymentsService.
   */
  async subscribe(
    studentId: string,
    plan: 'foundation' | 'mastery' | 'elite',
    verifiedPurchaseId?: string,
  ): Promise<CreditStatus> {
    if (!verifiedPurchaseId) {
      throw new ForbiddenException('Direct subscription without verified purchase is not allowed.');
    }

    const creditMap = { foundation: 8, mastery: 16, elite: 24 };
    const credits = creditMap[plan];

    if (!credits) {
      throw new BadRequestException('Invalid plan');
    }

    const now = new Date();
    const ends = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Payment verification assumed to be done by verifiedPurchaseId check above
    // Real-world: Could verify verifiedPurchaseId against DB status here again

    const planMappings = {
      foundation: { programId: 'foundation-program-id', packageId: 'us-foundation-package-id' },
      mastery: { programId: 'mastery-program-id', packageId: 'us-mastery-package-id' },
      elite: { programId: 'elite-program-id', packageId: 'us-elite-package-id' },
    };
    
    const mapping = planMappings[plan];
    if (!mapping) {
      throw new BadRequestException('Invalid plan mapping');
    }

    const updated = await this.prisma.students.update({
      where: { id: studentId },
      data: {
        subscription_plan: plan,
        subscription_credits: credits,
        subscription_starts: now,
        subscription_ends: ends,
        is_trial_active: false, // trial ends when subscription starts
        enrollment_status: 'learning', // Move to learning mode
        program_id: mapping.programId,
        package_id: mapping.packageId,
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
      const isLearning = student.enrollment_status === 'learning';
      // Add credits to correct balance depending on mode (learning vs trial) using atomic increment
      await tx.students.update({
        where: { id: studentId },
        data: isLearning
          ? {
              subscription_credits: { increment: credits },
            }
          : {
              trial_credits: { increment: credits },
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

  /**
   * Cron: Expire stale subscriptions and automatically pause active enrollments.
   * Runs daily at midnight.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expireStaleSubscriptions(): Promise<number> {
    const now = new Date();
    
    // Find all students with an active subscription plan that has expired
    const expiredStudents = await this.prisma.students.findMany({
      where: {
        enrollment_status: 'learning',
        subscription_ends: { lt: now },
      },
      select: { id: true, user_id: true },
    });

    if (expiredStudents.length === 0) return 0;

    const studentIds = expiredStudents.map(s => s.id);
    const userIds = expiredStudents.map(s => s.user_id).filter(Boolean) as string[];

    await this.prisma.$transaction(async (tx) => {
      // 1. Reset students to trial or basic state so they can't book new sessions
      await tx.students.updateMany({
        where: { id: { in: studentIds } },
        data: {
          enrollment_status: 'trial',
          subscription_credits: 0,
        },
      });

      // 2. Automatically pause all active enrollments for these students to stop weekly scheduling crons
      await tx.enrollments.updateMany({
        where: {
          student_id: { in: studentIds },
          status: 'active',
        },
        data: {
          status: 'paused',
        },
      });
      
      // 3. Reset any legacy user_credits records for these user_ids
      if (userIds.length > 0) {
        await tx.user_credits.updateMany({
          where: {
            user_id: { in: userIds },
          },
          data: {
            credits_total: 0,
            credits_used: 0,
          },
        });
      }
    });

    this.logger.log(`Expired ${expiredStudents.length} stale subscription(s) and paused their active enrollments.`);
    return expiredStudents.length;
  }

  // ─── EXISTING CREDIT SYSTEM (subscription-based) ─────────────────

  /**
   * Grant credits to user after successful payment
   */
  async grantCredits(userId: string, packageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const pkg = await tx.packages.findUnique({
        where: { id: packageId },
      });

      if (!pkg || !pkg.active) {
        throw new BadRequestException('Package not found or inactive');
      }

      const creditsTotal = this.calculateCreditsFromPackage(pkg);

      const existingCredits = await tx.user_credits.findFirst({
        where: { 
          user_id: userId,
          reset_date: { gt: new Date() },
        },
      });

      if (existingCredits) {
        await tx.user_credits.update({
          where: { id: existingCredits.id },
          data: {
            credits_total: creditsTotal,
            credits_used: 0,
            reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            updated_at: new Date(),
          },
        });
      } else {
        await tx.user_credits.create({
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
      await tx.students.updateMany({
        where: { user_id: userId },
        data: {
          enrollment_status: 'learning',
          sessions_remaining: creditsTotal,
          package_end_date: subEnds, // Sync package_end_date to 30 days to resolve GAP 2!
          // New credit system fields — these are what BookingsService reads
          subscription_plan: planName,
          subscription_credits: creditsTotal, // Reset credits to new plan's value (non-stacking) to resolve GAP 1!
          subscription_starts: new Date(),
          subscription_ends: subEnds,
          is_trial_active: false,
        },
      });
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
      await this.prisma.$transaction(async (tx) => {
        await tx.user_credits.update({
          where: { id: credit.id },
          data: {
            reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            credits_total: 0,
            credits_used: 0,
            updated_at: new Date(),
          },
        });

        // Sync to students table subscription fields to keep consistency
        await tx.students.updateMany({
          where: { user_id: credit.user_id },
          data: {
            enrollment_status: 'trial',
            subscription_credits: 0,
          },
        });

        // Pause associated enrollments
        const students = await tx.students.findMany({
          where: { user_id: credit.user_id },
          select: { id: true },
        });
        const studentIds = students.map(s => s.id);
        if (studentIds.length > 0) {
          await tx.enrollments.updateMany({
            where: { student_id: { in: studentIds }, status: 'active' },
            data: { status: 'paused' },
          });
        }
      });

      this.logger.log(`Reset credits for user ${credit.user_id} and synced student subscription fields.`);
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

  /**
   * Revoke subscription credits (e.g. after a refund or cancellation)
   */
  async revokeCredits(userId: string): Promise<void> {
    const students = await this.prisma.students.findMany({
      where: { user_id: userId },
      select: { id: true },
    });

    const studentIds = students.map(s => s.id);

    await this.prisma.$transaction(async (tx) => {
      // 1. Reset students subscription credits and enrollment status
      await tx.students.updateMany({
        where: { user_id: userId },
        data: {
          enrollment_status: 'trial',
          subscription_credits: 0,
          subscription_plan: null,
          subscription_ends: null,
        },
      });

      // 2. Pause active enrollments
      if (studentIds.length > 0) {
        await tx.enrollments.updateMany({
          where: {
            student_id: { in: studentIds },
            status: 'active',
          },
          data: {
            status: 'paused',
          },
        });
      }

      // 3. Reset legacy user_credits records
      await tx.user_credits.updateMany({
        where: { user_id: userId },
        data: {
          credits_total: 0,
          credits_used: 0,
        },
      });
    });

    this.logger.log(`Revoked credits for user ${userId} due to refund.`);
  }
}
