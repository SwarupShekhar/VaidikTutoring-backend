import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TutorStatusGuard implements CanActivate {
    constructor(private readonly prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || user.role !== 'tutor') return true;

        // Real-time DB check — JWT cache cannot be trusted for suspension enforcement
        const tutor = await this.prisma.tutors.findFirst({
            where: { user_id: user.userId || user.id },
            select: { is_active: true, tutor_approved: true },
        });

        if (!tutor || tutor.is_active === false || tutor.tutor_approved === false) {
            throw new ForbiddenException('TUTOR_SUSPENDED');
        }

        return true;
    }
}
