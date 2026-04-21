import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BookingAlertsService {
  private readonly logger = new Logger(BookingAlertsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  @Cron('0 */1 * * * *')  // Every minute
  async sendDelayedAlerts() {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    const unallocatedBookings = await this.prisma.bookings.findMany({
      where: {
        created_at: { lte: fifteenMinutesAgo },
        assigned_tutor_id: null,
        status: { in: ['available', 'open'] },  // Adjust status as needed
      },
      include: { subjects: true },
    });

    for (const booking of unallocatedBookings) {
      // Find eligible tutors for this subject (simplified logic - fetch all active tutors)
      const tutors = await this.prisma.tutors.findMany({
        where: {
          is_active: true,
        },
        include: { users: true },
      });

      // Filter tutors by skills in memory
      const eligibleTutors = tutors.filter(tutor => {
        const skills = tutor.skills as any;
        return skills?.subjects?.includes(booking.subject_id);
      });

      for (const tutor of eligibleTutors) {
        this.notificationsService.notifyTutorAllocation(
          tutor.user_id,
          'A Student',  // Fetch student name if available
          booking.requested_start?.toString() || 'Scheduled Time'
        );
      }

      // Mark as alerted to prevent duplicates
      await this.prisma.bookings.update({
        where: { id: booking.id },
        data: { status: 'alerted' },  // Add this status if needed, or use a flag
      });
    }
  }
}