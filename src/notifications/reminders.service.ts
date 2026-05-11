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
        const frontendUrl = process.env.FRONTEND_URL || 'https://studyhours.com';
        const rawLink = session.meet_link || '';
        const meetingLink = rawLink.startsWith('http') 
          ? rawLink 
          : `${frontendUrl.replace(/\/$/, '')}${rawLink.startsWith('/') ? '' : '/'}${rawLink}`;

        const formattedDate = new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short'
        }).format(new Date(session.start_time!));

        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <h2 style="color: #6366f1; margin-top: 0; margin-bottom: 20px;">Session Reminder</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #333;">Your upcoming session for <strong>${booking.subjects?.name || 'Class'}</strong> is starting soon!</p>
            
            <div style="background-color: #f8fafc; border-left: 4px solid #6366f1; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>Date & Time:</strong></p>
              <p style="margin: 0; font-size: 15px; color: #475569;">${formattedDate}</p>
            </div>
            
            <div style="margin: 35px 0; text-align: center;">
              <a href="${meetingLink}" style="background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2);">Join Classroom</a>
            </div>
            
            <p style="font-size: 14px; color: #64748b; margin-top: 30px; line-height: 1.6;">If you have any questions, you can message your tutor from your dashboard.</p>
            
            <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 25px 0;" />
            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">StudyHours • Premium Academic Support</p>
          </div>
        `;

        await this.emailService.sendMail({
          to: recipients,
          subject: `Reminder: Session in ${hoursAhead} hour(s) - StudyHours`,
          text: `Your session for ${booking.subjects?.name} starts at ${formattedDate}.\nLink: ${meetingLink}`,
          html: html,
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
