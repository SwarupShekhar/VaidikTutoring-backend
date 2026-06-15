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
}
