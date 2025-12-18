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
  async notifyAdminBooking(studentName: string) {
    // Wrapper for gateway method
    this.gateway.notifyAdminBooking(studentName);
  }

  async notifyStudentAllocation(userId: string, tutorName: string) {
    this.gateway.notifyStudentAllocation(userId, tutorName);
  }

  async notifyTutorAllocation(userId: string, studentName: string, scheduledTime: string) {
    this.gateway.notifyTutorAllocation(userId, studentName, scheduledTime);
  }
}
