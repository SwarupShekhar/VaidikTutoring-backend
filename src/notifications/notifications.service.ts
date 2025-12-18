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

    // 2. Emit Real-time Event
    // Map internal types to frontend socket events
    if (type === 'session_assigned' || type === 'session_allocated') {
      // For Tutor/Student
      this.gateway.notifyUser(userId, 'booking:allocated', {
        ...payload,
        notificationId: saved.id,
      });
    } else if (type === 'session_confirmed') {
      // For Student
      this.gateway.notifyUser(userId, 'booking:allocated', {
        ...payload,
        notificationId: saved.id,
      });
    } else if (type === 'booking_created' || type === 'admin_alert') {
      // For Admin (if userId is generic or we just want to broadcast)
      // Usually admins also have userIds, but creating for specific admin userId vs broadcast is different.
      // If userId is passed, notify that user.
      this.gateway.notifyUser(userId, 'booking:created', {
        ...payload,
        notificationId: saved.id,
      });
    }

    return saved;
  }

  // Helper to broadcast to all admins (if not bound to a single user in DB)
  async notifyAdmins(type: string, payload: any) {
    this.gateway.notifyAdmins(type, payload);
    // Optionally save to DB for a generic admin user or skipping DB for broadcast
  }

  async findAll(userId: string) {
    return this.prisma.notifications.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
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
}
