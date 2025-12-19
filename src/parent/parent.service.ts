import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ParentService {
    constructor(private prisma: PrismaService) { }

    async createStudent(parentId: string, dto: { name: string; grade: string; email?: string }) {
        // 1. Validate parent exists (optional, guarded by auth usually)

        // 2. Create User (Role STUDENT, No Password yet)
        // Email is optional for child? If not provided, generate a dummy one?
        // User model requires email @unique. 
        // If param email is missing, generate: `student_${timestamp}_${random}@placeholder.com`
        const email = dto.email || `student_${Date.now()}_${Math.floor(Math.random() * 1000)}@no-email.com`;

        // Transaction to ensure both exist or neither
        return this.prisma.$transaction(async (tx) => {
            const user = await tx.users.create({
                data: {
                    email,
                    role: 'student',
                    parent_id: parentId, // The new self-relation
                    first_name: dto.name.split(' ')[0],
                    last_name: dto.name.split(' ').slice(1).join(' ') || '',
                    email_verified: true, // Parent managed, considered verified
                    password_hash: null, // No password initially
                    is_active: true,
                },
            });

            // 3. Create Profile
            const student = await tx.students.create({
                data: {
                    user_id: user.id,
                    parent_user_id: parentId, // The old relation, keeping for compatibility
                    grade: dto.grade,
                    first_name: user.first_name,
                    last_name: user.last_name,
                }
            });

            return { user, student };
        });
    }

    async getChildren(parentId: string) {
        return this.prisma.students.findMany({
            where: { parent_user_id: parentId },
            include: {
                users_students_user_idTousers: {
                    select: {
                        email: true,
                        id: true,
                        is_active: true
                    }
                }
            }
        });
    }
}
