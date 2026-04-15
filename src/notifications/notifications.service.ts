import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) { }

  async create(userId: string, type: string, payload: any) {
    // 1. Save to DB
    const saved = await this.prisma.notifications.create({
      data: {
        user_id: userId,
        type,
        payload,
        is_read: false,
      },
    });

    // 2. Emit Real-time Event - DEPRECATED/MOVED
    // The new Gateway implementation uses specific methods called explicitly by services.
    // We only save to DB here.
    return saved;
  }


  async findAll(userId: string) {
    const list = await this.prisma.notifications.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return list.map(n => ({
      ...n,
      message: (n.payload as any)?.message || 'New notification',
      read: n.is_read
    }));
  }

  async markAllRead(userId: string) {
    return this.prisma.notifications.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });
  }

  async markAsRead(id: string, userId: string) {
    // Ensure ownership
    const notif = await this.prisma.notifications.findFirst({
      where: { id, user_id: userId },
    });
    if (!notif) return null;

    return this.prisma.notifications.update({
      where: { id },
      data: { is_read: true },
    });
  }
  async notifyAdminBooking(studentName: string) {
    // 1. Websocket alert (real-time)
    this.gateway.notifyAdminBooking(studentName);

    // 2. Persist to DB for all admins (so it shows in bell icon history)
    try {
      const admins = await this.prisma.users.findMany({
        where: { role: 'admin', is_active: true }
      });

      for (const admin of admins) {
        await this.create(admin.id, 'booking_created', {
          message: `Student ${studentName} just booked a new session!`,
          studentName
        });
      }
    } catch (e) {
      this.logger.error(`Failed to persist admin notifications: ${e.message}`);
    }
  }

  async notifyStudentAllocation(userId: string, tutorName: string) {
    this.gateway.notifyStudentAllocation(userId, tutorName);
  }

  async notifyTutorAllocation(userId: string, studentName: string, scheduledTime: string) {
    this.gateway.notifyTutorAllocation(userId, studentName, scheduledTime);
  }

  async notifyAdminSupport(ticketId: string, userName: string, message: string) {
    // 1. Real-time to all connected admin clients
    this.gateway.notifyAdminSupport(ticketId, userName, message);

    // 2. Persist to DB bell notification for every admin
    try {
      const admins = await this.prisma.users.findMany({
        where: { role: 'admin', is_active: true },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.create(admin.id, 'support_ticket', {
          message: `New help request from ${userName}`,
          ticketId,
          preview: message.slice(0, 120),
          link: '/admin/dashboard?tab=support',
        });
      }
    } catch (e) {
      this.logger.error(`Failed to persist support notifications: ${e.message}`);
    }
  }

  async notifyParentSessionNote(parentId: string, childId: string, tutorName: string) {
    // Save to DB (Task 4)
    await this.create(parentId, 'session_note', {
      message: `Your child's session with ${tutorName} is complete. ${tutorName} left a note for you.`,
      tutorName,
      childId,
      link: `/parent/children/${childId}/sessions`,
    });

    // Real-time alert
    this.gateway.notifyParentSessionNote(parentId, childId, tutorName);
  }

  /**
   * Universal method to alert all active admins
   */
  async notifyAdmins(type: string, payload: { message: string; [key: string]: any }) {
    try {
      // 1. Persist to DB for all admins
      const admins = await this.prisma.users.findMany({
        where: { role: 'admin', is_active: true },
        select: { id: true },
      });

      for (const admin of admins) {
        await this.create(admin.id, type, payload);
      }

      // 2. Real-time broadcast
      this.gateway.notifyAdmin('admin:alert', {
        type,
        ...payload,
        created_at: new Date(),
      });

      this.logger.log(`Admin alert sent: ${type} - ${payload.message}`);
    } catch (e) {
      this.logger.error(`Error notifying admins: ${e.message}`);
    }
  }

  /**
   * Notify tutor about unclaimed booking (15-minute fallback)
   * Sends real-time toast notification to tutor dashboard
   */
  notifyTutorBookingFallback(
    tutorUserId: string,
    studentName: string,
    subjectName: string,
    startTime: Date,
  ) {
    try {
      const timeStr = startTime
        ? new Date(startTime).toLocaleTimeString()
        : 'Scheduled time';

      this.gateway.broadcastToTutor(tutorUserId, 'booking:unclaimed_fallback', {
        message: `⏰ A session with ${studentName} (${subjectName}) at ${timeStr} is still available!`,
        studentName,
        subjectName,
        startTime: startTime?.toISOString(),
        type: 'warning', // Toast type for frontend styling
        autoClose: 8000, // Auto-close after 8 seconds
      });

      this.logger.log(`Fallback notification sent to tutor ${tutorUserId}`);
    } catch (e) {
      this.logger.error(`Error sending fallback notification: ${e.message}`);
    }
  }
}
