import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ParentOwnsStudentGuard implements CanActivate {
    constructor(private prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        const body = request.body || {};

        if (!user) throw new ForbiddenException('Unauthenticated');

        // This guard scopes PARENTS and STUDENTS to their own student record.
        // Admins/tutors are governed by their own role checks — pass through.
        const role = user.role;
        if (role !== 'parent' && role !== 'student') return true;

        const studentId = body.student_id || request.params.studentId;
        if (!studentId) return true; // nothing to scope

        const student = await this.prisma.students.findUnique({
            where: { id: studentId },
            select: { parent_user_id: true, user_id: true },
        });

        // Fail CLOSED — a non-existent id must not slip through to a handler that
        // trusts the guard. (Previously returned true → student-role bypass.)
        if (!student) throw new ForbiddenException('You do not have access to this student');

        const owns =
            role === 'parent'
                ? student.parent_user_id === user.userId
                : student.user_id === user.userId;

        if (!owns) {
            throw new ForbiddenException('You do not have access to this student');
        }

        return true;
    }
}
