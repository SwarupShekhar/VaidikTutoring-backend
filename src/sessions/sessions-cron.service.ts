import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from './sessions.service';
import { SlackService } from '../slack/slack.service';

@Injectable()
export class SessionsCronService {
  private readonly logger = new Logger(SessionsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly slackService: SlackService,
  ) {}

  @Cron('0 */15 * * * *')
  async autoCompleteStuckSessions() {
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const stuckSessions = await this.prisma.sessions.findMany({
      where: { status: 'in_progress', start_time: { lt: cutoff } },
      include: { bookings: true },
    });

    for (const session of stuckSessions) {
      try {
        await this.prisma.sessions.update({
          where: { id: session.id, status: 'in_progress' },
          data: { status: 'completed', end_time: new Date() },
        });
      } catch (e: any) {
        if (e?.code === 'P2025') continue;
        throw e;
      }
      // Finalize any open attendance intervals for this auto-completed session.
      // Non-fatal so a single bad row can't abort the cron sweep.
      try {
        await this.sessionsService.finalizeSessionAttendance(session.id, new Date());
      } catch (e: any) {
        this.logger.error(`finalizeSessionAttendance failed for ${session.id} (non-fatal): ${e.message}`);
      }

      if (session.bookings?.student_id) {
        await this.sessionsService.handleSessionCompletion(
          session.id,
          session.bookings.student_id,
          session.start_time ?? undefined,
          new Date(),
        );
      }
    }

    if (stuckSessions.length > 0) {
      this.logger.warn(`Auto-completed ${stuckSessions.length} stuck session(s) older than 3 hours`);
    }
  }

  /**
   * §4 — alert when a completed session produced no recording. A session that
   * finished 2+ hours ago with no `session_recordings` row almost certainly
   * means the Daily.co → Azure webhook pipeline dropped the recording.
   */
  @Cron('0 */30 * * * *')
  async alertOnMissingRecordings() {
    const now = Date.now();
    const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000);
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);

    // ponytail: coarse dedup. We only consider sessions whose end_time falls in
    // a narrow 2h–4h window so each completed-but-unrecorded session is caught
    // by roughly one 30-min run. It can still double-fire (or miss) at the
    // window edges; the proper upgrade path is a persisted "recording_alert_sent"
    // flag on the session so each is alerted exactly once.
    const sessions = await this.prisma.sessions.findMany({
      where: {
        status: 'completed',
        end_time: { gte: fourHoursAgo, lte: twoHoursAgo },
        session_recordings: { none: {} },
      },
      select: { id: true, end_time: true, booking_id: true },
    });

    for (const session of sessions) {
      try {
        await this.slackService.sendAlert(
          `:red_circle: Missing recording — session ${session.id} (booking ${session.booking_id ?? 'n/a'}) ` +
            `completed at ${session.end_time?.toISOString() ?? 'unknown'} but has no recording after 2h+. ` +
            `Check the Daily.co → Azure recording webhook pipeline.`,
        );
      } catch (e: any) {
        // Non-fatal: one Slack failure shouldn't abort the sweep.
        this.logger.error(`Failed to send missing-recording alert for ${session.id}: ${e.message}`);
      }
    }

    if (sessions.length > 0) {
      this.logger.warn(`Alerted on ${sessions.length} completed session(s) with no recording`);
    }
  }
}
