import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { EmailService } from 'src/email/email.service';
import { addHours, subHours } from 'date-fns';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.debug('Running session reminders cron...');
    await this.checkUpcomingSessions(1); // 1 hour reminder
    await this.checkUpcomingSessions(24); // 24 hour reminder
  }

  async checkUpcomingSessions(hoursAhead: number) {
    const now = new Date();
    const targetTimeWinStart = addHours(now, hoursAhead);
    const targetTimeWinEnd = addHours(now, hoursAhead + 1); // 1 hour window

    // Find scheduled sessions starting in this window
    // Note: Ideally we track 'reminder_sent' in a separate table or field.
    // For this MVP, we might re-send if we don't track it.
    // Let's rely on checking `notifications` table to avoid duplicates.

    const sessions = await this.prisma.sessions.findMany({
      where: {
        status: 'scheduled',
        start_time: {
          gte: targetTimeWinStart,
          lt: targetTimeWinEnd,
        },
      },
      include: {
        bookings: {
          include: {
            students: {
              include: {
                users_students_user_idTousers: true,
                users_students_parent_user_idTousers: true,
              },
            },
            tutors: { include: { users: true } },
            subjects: true,
          },
        },
      },
    });

    for (const session of sessions) {
      const booking = session.bookings;
      if (!booking) continue;

      // Check duplicate using notifications table
      const alreadySent = await this.prisma.notifications.findFirst({
        where: {
          type: `reminder_${hoursAhead}h`,
          payload: { path: ['session_id'], equals: session.id },
        },
      });

      if (alreadySent) continue;

      // Recipients
      const recipients: string[] = [];
      const studentUser = booking.students?.users_students_user_idTousers;
      const parentUser = booking.students?.users_students_parent_user_idTousers;
      const tutorUser = booking.tutors?.users;

      if (studentUser?.email) recipients.push(studentUser.email);
      if (parentUser?.email) recipients.push(parentUser.email);
      if (tutorUser?.email) recipients.push(tutorUser.email);

      if (recipients.length > 0) {
        await this.emailService.sendMail({
          to: recipients,
          subject: `Reminder: Session in ${hoursAhead} hour(s)`,
          text: `Your session for ${booking.subjects?.name} starts at ${session.start_time}.\nLink: ${session.meet_link}`,
        });

        // Record notification
        await this.prisma.notifications.create({
          data: {
            type: `reminder_${hoursAhead}h`,
            payload: { session_id: session.id },
            is_read: true, // system notification
            // Link to a user? Ideally we link to multiple, but schema has single user_id.
            // We can create multiple or just leave user_id null for system log.
            user_id: null,
          },
        });

        this.logger.log(
          `Sent ${hoursAhead}h reminder for session ${session.id} to ${recipients.length} recipients.`,
        );
      }
    }
  }
}
