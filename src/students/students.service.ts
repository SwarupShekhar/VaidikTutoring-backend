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

        if (existingCount >= 10) { // Increased limit or keep as per requirements
            throw new BadRequestException('You can only add up to 10 students.');
        }

        // 0. Check for duplicates (by name and parent)
        const existingStudent = await this.prisma.students.findFirst({
            where: {
                parent_user_id: parentUserId,
                first_name: {
                    equals: data.first_name,
                    mode: 'insensitive',
                },
            },
        });

        if (existingStudent) {
            throw new BadRequestException('Student with this name already exists.');
        }

        // Create Student directly
        return this.prisma.students.create({
            data: {
                parent_user_id: parentUserId,
                first_name: data.first_name,
                last_name: data.last_name,
                grade: data.grade,
                school: data.school,
                curriculum_preference: data.curriculum_preference,
            },
        });
    }

    async findAllByParent(parentUserId: string) {
        return this.prisma.students.findMany({
            where: { parent_user_id: parentUserId },
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
