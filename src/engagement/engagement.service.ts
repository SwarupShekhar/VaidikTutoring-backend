import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { verifyEngagementToken } from './engagement-token';

const FRONTEND = (process.env.FRONTEND_URL || 'https://studyhours.com').replace(/\/$/, '');

/** Allowed answer keys per MCQ email type. */
const ALLOWED_ANSWERS: Record<string, readonly string[]> = {
  mcq_academic: ['subject_help', 'exam_prep', 'catching_up', 'get_ahead'],
  mcq_friction: ['too_busy', 'not_sure', 'price', 'browsing'],
};

/** Human-readable phrase written to students.recent_focus for academic answers. */
const ACADEMIC_FOCUS_PHRASE: Record<string, string> = {
  subject_help: 'Struggling with a subject',
  exam_prep: 'Preparing for an exam',
  catching_up: 'Fallen behind, catching up',
  get_ahead: 'Wants to get ahead',
};

@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an MCQ answer tapped from an email. Returns the frontend redirect target.
   * Invalid token / type / answer all route to the friendly "expired" page.
   */
  async recordAnswer(token: string, answer: string): Promise<string> {
    const payload = verifyEngagementToken(token);
    if (!payload) {
      return `${FRONTEND}/thanks?expired=1`;
    }

    const allowed = ALLOWED_ANSWERS[payload.type];
    if (!allowed || !answer || !allowed.includes(answer)) {
      return `${FRONTEND}/thanks?expired=1`;
    }

    const now = new Date();
    await this.prisma.email_events.upsert({
      where: { user_id_type: { user_id: payload.user_id, type: payload.type } },
      update: { answer, answered_at: now },
      create: { user_id: payload.user_id, type: payload.type, answer, answered_at: now },
    });

    if (payload.type === 'mcq_academic') {
      try {
        const phrase = ACADEMIC_FOCUS_PHRASE[answer];
        const student = await this.prisma.students.findFirst({
          where: { user_id: payload.user_id },
        });
        if (student && phrase) {
          await this.prisma.students.update({
            where: { id: student.id },
            data: { recent_focus: phrase },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to write recent_focus for user ${payload.user_id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return `${FRONTEND}/thanks?type=${payload.type}&a=${answer}`;
  }

  /**
   * Toggle a user's marketing opt-out. Returns the frontend redirect target.
   * `resubscribe = true` re-opts the user in (misclick guard on the confirmation page).
   */
  async setOptOut(token: string, resubscribe: boolean): Promise<string> {
    const payload = verifyEngagementToken(token);
    if (!payload) {
      return `${FRONTEND}/unsubscribed?expired=1`;
    }

    try {
      await this.prisma.users.update({
        where: { id: payload.user_id },
        data: { email_opted_out: !resubscribe },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to set email_opted_out for user ${payload.user_id}: ${error instanceof Error ? error.message : error}`,
      );
    }

    return resubscribe
      ? `${FRONTEND}/unsubscribed?t=${token}&resubscribed=1`
      : `${FRONTEND}/unsubscribed?t=${token}`;
  }
}
