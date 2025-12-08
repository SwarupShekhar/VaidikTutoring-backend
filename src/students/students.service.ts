import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class StudentsService {
    constructor(private prisma: PrismaService) { }

    async create(
        data: {
            first_name: string;
            last_name?: string;
            grade: string;
            school: string;
            curriculum_preference?: string;
        },
        parentUserId: string,
    ) {
        // -1. Check max students limit
        const existingCount = await this.prisma.students.count({
            where: { parent_user_id: parentUserId },
        });

        if (existingCount >= 3) {
            throw new BadRequestException('You can only add up to 3 students.');
        }

        // 0. Check for duplicates
        const existingStudent = await this.prisma.students.findFirst({
            where: {
                parent_user_id: parentUserId,
                users_students_user_idTousers: {
                    first_name: {
                        equals: data.first_name,
                        mode: 'insensitive',
                    },
                },
            },
        });

        if (existingStudent) {
            throw new BadRequestException('Student with this name already exists.');
        }

        // 1. Generate placeholder email -> student.<firstname>.<timestamp>@vibespark.placeholder
        const cleanName = data.first_name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const timestamp = Date.now();
        const email = `student.${cleanName}.${timestamp}@vibespark.placeholder`;

        // 2. Dummy password
        const passwordHash = await bcrypt.hash(`student-${timestamp}`, 10);

        // 3. Create User & Student in transaction
        return this.prisma.$transaction(async (tx) => {
            const user = await tx.users.create({
                data: {
                    email,
                    role: 'student',
                    password_hash: passwordHash,
                    first_name: data.first_name,
                    last_name: data.last_name,
                    is_active: true,
                },
            });

            const student = await tx.students.create({
                data: {
                    user_id: user.id,
                    parent_user_id: parentUserId,
                    grade: data.grade,
                    school: data.school,
                    curriculum_preference: data.curriculum_preference,
                },
            });

            return student;
        });
    }

    async findAllByParent(parentUserId: string) {
        return this.prisma.students.findMany({
            where: { parent_user_id: parentUserId },
            include: {
                // Include user if you need first_name/last_name
                users_students_user_idTousers: {
                    select: { first_name: true, last_name: true },
                },
            },
        });
    }

    async delete(studentId: string, parentUserId: string) {
        // Verify ownership
        const student = await this.prisma.students.findUnique({
            where: { id: studentId },
        });
        if (!student || student.parent_user_id !== parentUserId) {
            throw new NotFoundException('Student not found or access denied');
        }
        // Delete (cascade might handle user, but safe to delete student first)
        // If you want to delete the linked User account too, you might need a transaction
        // For now, let's just delete the Student record.
        return this.prisma.students.delete({
            where: { id: studentId },
        });
    }
}
