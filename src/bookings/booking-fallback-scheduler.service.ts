import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BookingFallbackSchedulerService {
  private readonly logger = new Logger(BookingFallbackSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Scheduled task: Check for assignments older than 15 minutes that haven't been joined
   * Runs every 5 minutes to catch unjoined assignments
   * Prevents repeated broadcasts using fallback_broadcasted_at field
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleUnclaimedAssignments() {
    try {
      // Configurable thresholds via environment variables
      const FALLBACK_TIMEOUT_MINUTES = parseInt(
        process.env.BOOKING_FALLBACK_TIMEOUT_MINUTES || '15',
        10,
      );
      const BROADCAST_COOLDOWN_MINUTES = parseInt(
        process.env.BROADCAST_COOLDOWN_MINUTES || '5',
        10,
      );
      const ONLINE_THRESHOLD_MINUTES = parseInt(
        process.env.TUTOR_ONLINE_THRESHOLD_MINUTES || '30',
        10,
      );

      const fallbackTimeoutAgo = new Date(
        Date.now() - FALLBACK_TIMEOUT_MINUTES * 60 * 1000,
      );
      const broadcastCooldown = new Date(
        Date.now() - BROADCAST_COOLDOWN_MINUTES * 60 * 1000,
      );
      const onlineThresholdAgo = new Date(
        Date.now() - ONLINE_THRESHOLD_MINUTES * 60 * 1000,
      );

      // Find assignments older than fallback timeout
      const potentialBookings = await this.prisma.bookings.findMany({
        where: {
          assigned_tutor_id: { not: null },
          status: 'confirmed',
          created_at: { lte: fallbackTimeoutAgo },
          OR: [
            { fallback_broadcasted_at: null },
            { fallback_broadcasted_at: { lte: broadcastCooldown } },
          ],
        },
        include: {
          sessions: {
            where: { status: 'in_progress' },
          },
          tutors: { include: { users: true } },
          students: true,
          subjects: true,
          program: true,
        },
      });

      // Manually filter bookings that have no active session
      const unclaimedBookings = potentialBookings.filter(
        (b) => b.sessions.length === 0,
      );

      if (unclaimedBookings.length === 0) {
        return; // No unclaimed bookings needing broadcast
      }

      this.logger.log(
        `Found ${unclaimedBookings.length} unclaimed bookings eligible for fallback broadcast`,
      );

      // For each unclaimed booking, broadcast to online tutors in the same program/subject
      for (const booking of unclaimedBookings) {
        await this.broadcastToOnlineTutors(booking, onlineThresholdAgo);
      }
    } catch (error) {
      this.logger.error(
        `Error in handleUnclaimedAssignments: ${error.message}`,
      );
    }
  }

  /**
   * Broadcast booking opportunity to all online tutors in the same program/subject
   */
  private async broadcastToOnlineTutors(
    booking: any,
    onlineThresholdAgo?: Date,
  ) {
    try {
      // Use passed threshold or read from env (fallback to 30 minutes)
      if (!onlineThresholdAgo) {
        const ONLINE_THRESHOLD_MINUTES = parseInt(
          process.env.TUTOR_ONLINE_THRESHOLD_MINUTES || '30',
          10,
        );
        onlineThresholdAgo = new Date(
          Date.now() - ONLINE_THRESHOLD_MINUTES * 60 * 1000,
        );
      }

      // Find all tutors who:
      // 1. Are in the same program
      // 2. Have the required subject skills
      // 3. Were active within threshold (online)
      // 4. Are NOT the originally assigned tutor
      const onlineTutors = await this.prisma.tutors.findMany({
        where: {
          program_id: booking.program_id,
          is_active: true,
          tutor_approved: true,
          id: { not: booking.assigned_tutor_id }, // Exclude original assignee
          last_seen: { gte: onlineThresholdAgo }, // Online within configured threshold
        },
        include: { users: true },
      });

      // Filter tutors by subject expertise
      let matchingTutors = onlineTutors.filter((tutor) => {
        const skills = tutor.skills as any;
        return (
          skills &&
          skills.subjects &&
          Array.isArray(skills.subjects) &&
          skills.subjects.includes(booking.subject_id)
        );
      });

      // ADDITIONAL CHECK: Filter out tutors with overlapping sessions
      // Only suggest tutors who don't already have a session at the same time
      if (
        matchingTutors.length > 0 &&
        booking.requested_start &&
        booking.requested_end
      ) {
        const busyTutorIds = new Set<string>();
        const conflicts = await this.prisma.bookings.findMany({
          where: {
            assigned_tutor_id: { in: matchingTutors.map((t) => t.id) },
            status: { in: ['confirmed', 'requested', 'in_progress'] },
            AND: [
              { requested_start: { lte: booking.requested_end } },
              { requested_end: { gte: booking.requested_start } },
            ],
          },
          select: { assigned_tutor_id: true },
        });

        conflicts.forEach((c) => {
          if (c.assigned_tutor_id) busyTutorIds.add(c.assigned_tutor_id);
        });

        matchingTutors = matchingTutors.filter(
          (tutor) => !busyTutorIds.has(tutor.id),
        );
      }

      if (matchingTutors.length === 0) {
        this.logger.log(
          `No matching online tutors for booking ${booking.id}`,
        );
        return;
      }

      this.logger.log(
        `Broadcasting booking ${booking.id} to ${matchingTutors.length} online tutors`,
      );

      // Send notification to each matching tutor
      for (const tutor of matchingTutors) {
        const studentName = booking.students
          ? `${booking.students.first_name} ${booking.students.last_name || ''}`.trim()
          : 'A Student';

        const message = `⏰ Assignment unclaimed for 15 minutes! A session with ${studentName} (${booking.subjects?.name || 'Subject'}) is available. Time: ${booking.requested_start?.toLocaleString()}`;

        // DB notification
        await this.notificationsService.create(tutor.user_id, 'booking_unclaimed', {
          message,
          bookingId: booking.id,
          studentName,
          subjectName: booking.subjects?.name,
          startTime: booking.requested_start?.toISOString(),
          claimUrl: `/tutor/claim-session/${booking.id}`,
        });

        // Real-time WebSocket notification
        this.notificationsService.notifyTutorBookingFallback(
          tutor.user_id,
          studentName,
          booking.subjects?.name || 'Subject',
          booking.requested_start,
        );
      }

      // Update fallback_broadcasted_at to prevent repeated notifications
      await this.prisma.bookings.update({
        where: { id: booking.id },
        data: { fallback_broadcasted_at: new Date() },
      });

      this.logger.log(
        `Updated fallback_broadcasted_at for booking ${booking.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Error broadcasting to online tutors: ${error.message}`,
      );
    }
  }
}
