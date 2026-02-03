import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
      interests?: string[];
      recent_focus?: string;
      struggle_areas?: string[];
    },
    parentUserId: string,
  ) {
    // -1. Check max students limit
    const existingCount = await this.prisma.students.count({
      where: { parent_user_id: parentUserId },
    });

    if (existingCount >= 10) {
      // Increased limit or keep as per requirements
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
        interests: data.interests || [],
        recent_focus: data.recent_focus || '',
        struggle_areas: data.struggle_areas || [],
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

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Parent check: ensure the student belongs to the requesting parent
    if (student.parent_user_id !== parentUserId) {
      // Also allow if the user *is* the student (though this endpoint might be parent-only usually)
      // But requirement says "returns the updated parent object", implying parent context.
      // Strict check:
      throw new NotFoundException('Student not found or access denied');
    }

    try {
      // Hard Delete
      await this.prisma.students.delete({
        where: { id: studentId },
      });
    } catch (error) {
      // Check for foreign key constraint violation (Prisma error code P2003)
      if (error.code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete student with active bookings or history.',
        );
      }
      throw error;
    }

    // Return updated parent object (or at least the list of remaining students,
    // but prompt asks for "updated parent object". The Parent is a User.
    // Maybe they mean "updated list of students for the parent"?
    // Or the User object itself? Usually refreshing the students list is what's needed.
    // I will return the User object enriched with students to be safe and very helpful.

    return this.prisma.users.findUnique({
      where: { id: parentUserId },
      include: {
        students_students_parent_user_idTousers: true,
      },
    });
  }
}
