import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from './sessions.service';

@Injectable()
export class SessionsCronService {
  private readonly logger = new Logger(SessionsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
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
}
