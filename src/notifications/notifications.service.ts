import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(userId: string, type: string, payload: any) {
        return this.prisma.notifications.create({
            data: {
                user_id: userId,
                type,
                payload,
                is_read: false,
            }
        });
    }

    async findAll(userId: string) {
        return this.prisma.notifications.findMany({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
            take: 50
        });
    }

    async markAsRead(id: string, userId: string) {
        // Ensure ownership
        const notif = await this.prisma.notifications.findFirst({
            where: { id, user_id: userId }
        });
        if (!notif) return null;

        return this.prisma.notifications.update({
            where: { id },
            data: { is_read: true }
        });
    }
}
