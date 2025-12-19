import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ParentOwnsStudentGuard implements CanActivate {
    constructor(private prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        const body = request.body;

        if (!user || user.role !== 'parent') {
            return true; // Let other guards handle role, or pass if logic is "Parent check only"
        }

        // Check if `student_id` is in body or params
        const studentId = body.student_id || request.params.studentId;

        if (!studentId) return true; // Nothing to check

        // Logic: Is this student a child of this parent?
        // We check the `students` table or `users` table. 
        // Since we maintain both links, `students` table is reliable for profile ID.
        // If studentId refers to `students.id` (Profile ID):
        const student = await this.prisma.students.findUnique({
            where: { id: studentId },
        });

        if (!student) return true; // Let downstream fail if not found

        if (student.parent_user_id !== user.userId) {
            throw new ForbiddenException('You do not have access to this student');
        }

        return true;
    }
}
