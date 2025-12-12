import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
    constructor(private readonly prisma: PrismaService) { }

    async getStats() {
        const studentsCount = await this.prisma.users.count({
            where: { role: 'student', is_active: true },
        });

        const parentsCount = await this.prisma.users.count({
            where: { role: 'parent', is_active: true },
        });

        const upcomingSessionsCount = await this.prisma.sessions.count({
            where: {
                start_time: {
                    gt: new Date(),
                },
                status: 'scheduled',
            },
        });

        return {
            students: studentsCount,
            parents: parentsCount,
            upcomingSessions: upcomingSessionsCount,
        };
    }
}
