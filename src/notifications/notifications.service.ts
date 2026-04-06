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
}
