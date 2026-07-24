import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

type DueUser = {
  id: string;
  email: string;
  first_name: string | null;
  lead_source: string | null;
};

/**
 * Behavioral onboarding email engine. Runs hourly and implements the
 * incomplete-onboarding branch of the signup lifecycle:
 *
 *   - mcq_academic   age > 24h, onboarding incomplete
 *   - mcq_friction   age > 4d, incomplete, AND no MCQ tapped yet
 *   - breakup        age > 8d, incomplete
 *
 * Idempotency is enforced by `email_events` (@@unique([user_id, type])):
 * a row of the given type means the user has already received it. The
 * `welcome` email fires at account creation (ClerkAuthGuard), not here.
 *
 * `email_events` has no Prisma relation to `users`, so "already sent" is
 * resolved by fetching the sent user-ids for the type and excluding them.
 */
@Injectable()
export class OnboardingCron {
  private readonly logger = new Logger(OnboardingCron.name);

  private static readonly DAY = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runBehavioralEmails() {
    await this.processRule('mcq_academic', 1, (u) =>
      this.email.sendMcqAcademicEmail(u.email, u.id, u.first_name || undefined, u.lead_source),
    );

    await this.processRule(
      'mcq_friction',
      4,
      (u) => this.email.sendMcqFrictionEmail(u.email, u.id, u.first_name || undefined, u.lead_source),
      { requireNoMcqTapped: true },
    );

    await this.processRule('breakup', 8, (u) =>
      this.email.sendBreakupEmail(u.email, u.id, u.first_name || undefined, u.lead_source),
    );

    // Booking nudge: onboarding complete but zero bookings after 2 days.
    await this.processBookingNudge();
  }

  /**
   * Finds users due for `type` (age threshold in days), sends the email, then
   * records an `email_events` row to prevent re-sends.
   */
  private async processRule(
    type: 'mcq_academic' | 'mcq_friction' | 'breakup',
    minAgeDays: number,
    send: (user: DueUser) => Promise<unknown>,
    opts: { requireNoMcqTapped?: boolean } = {},
  ) {
    const now = Date.now();
    const olderThan = new Date(now - minAgeDays * OnboardingCron.DAY); // created_at < this (old enough)
    const newerThan = new Date(now - 14 * OnboardingCron.DAY); // but within last 14 days

    try {
      // Users who already received this email (idempotency exclusion list).
      const alreadySent = await this.prisma.email_events.findMany({
        where: { type },
        select: { user_id: true },
      });
      const excludeIds = new Set(alreadySent.map((e) => e.user_id));

      // mcq_friction also suppresses if the user tapped ANY MCQ option.
      if (opts.requireNoMcqTapped) {
        const tapped = await this.prisma.email_events.findMany({
          where: { type: { startsWith: 'mcq_' }, answer: { not: null } },
          select: { user_id: true },
        });
        for (const e of tapped) excludeIds.add(e.user_id);
      }

      const due = await this.prisma.users.findMany({
        where: {
          role: { in: ['parent', 'student'] },
          onboarding_status: { not: 'complete' },
          email_opted_out: false,
          created_at: { lt: olderThan, gt: newerThan },
          id: excludeIds.size ? { notIn: Array.from(excludeIds) } : undefined,
        },
        select: { id: true, email: true, first_name: true, lead_source: true },
        take: 200,
      });

      if (!due.length) return;
      this.logger.log(`[${type}] sending to ${due.length} user(s)`);

      for (const user of due) {
        try {
          await send(user);
          // Record the send. createMany + skipDuplicates keeps this idempotent
          // even if two cron passes race or BullMQ retries upstream.
          await this.prisma.email_events.createMany({
            data: [{ user_id: user.id, type }],
            skipDuplicates: true,
          });
        } catch (err: any) {
          this.logger.error(`[${type}] failed for ${user.email}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`[${type}] query failed: ${err.message}`);
    }
  }

  /**
   * Booking nudge: users who completed onboarding 2+ days ago but have
   * zero bookings. Uses `email_events` type 'booking_nudge' for idempotency.
   */
  private async processBookingNudge() {
    const type = 'booking_nudge';
    const now = Date.now();
    const olderThan = new Date(now - 2 * OnboardingCron.DAY);
    const newerThan = new Date(now - 14 * OnboardingCron.DAY);

    try {
      const alreadySent = await this.prisma.email_events.findMany({
        where: { type },
        select: { user_id: true },
      });
      const excludeIds = new Set(alreadySent.map((e) => e.user_id));

      // Find users with completed onboarding but no bookings at all.
      const candidates = await this.prisma.users.findMany({
        where: {
          role: { in: ['parent', 'student'] },
          onboarding_status: 'complete',
          email_opted_out: false,
          created_at: { lt: olderThan, gt: newerThan },
          id: excludeIds.size ? { notIn: Array.from(excludeIds) } : undefined,
        },
        select: { id: true, email: true, first_name: true, lead_source: true },
        take: 200,
      });

      if (!candidates.length) return;

      // Resolve user IDs -> student IDs, then check bookings.
      const studentRecords = await this.prisma.students.findMany({
        where: { user_id: { in: candidates.map((c) => c.id) } },
        select: { id: true, user_id: true },
      });

      // Users who have a student profile with at least one booking.
      const studentIds = studentRecords.map((s) => s.id);
      const usersWithBookings = studentIds.length
        ? await this.prisma.bookings.findMany({
            where: { student_id: { in: studentIds } },
            select: { student_id: true },
            distinct: ['student_id'],
          })
        : [];
      const bookedStudentIds = new Set(usersWithBookings.map((b) => b.student_id));
      const studentToUser = new Map(studentRecords.map((s) => [s.id, s.user_id]));
      const bookedUserIds = new Set(
        [...bookedStudentIds].map((sid) => studentToUser.get(sid!)).filter(Boolean),
      );
      const due = candidates.filter((c) => !bookedUserIds.has(c.id));

      if (!due.length) return;
      this.logger.log(`[${type}] sending to ${due.length} user(s)`);

      for (const user of due) {
        try {
          await this.email.sendBookingNudgeEmail(
            user.email,
            user.id,
            user.first_name || undefined,
            user.lead_source,
          );
          await this.prisma.email_events.createMany({
            data: [{ user_id: user.id, type }],
            skipDuplicates: true,
          });
        } catch (err: any) {
          this.logger.error(`[${type}] failed for ${user.email}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`[${type}] query failed: ${err.message}`);
    }
  }
}
