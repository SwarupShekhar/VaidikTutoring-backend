// src/bookings/bookings.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBookingDto } from './create-booking.dto.js';
import { subMinutes } from 'date-fns';

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) { }

  // Create booking and attempt auto-assign tutor
  async create(createDto: CreateBookingDto) {
    // Validate referenced entities exist (student/package/subject/curriculum)
    const student = await this.prisma.students.findUnique({ where: { id: createDto.student_id } });
    if (!student) throw new NotFoundException('Student not found');

    const pkg = await this.prisma.packages.findUnique({ where: { id: createDto.package_id } });
    if (!pkg) throw new NotFoundException('Package not found');

    const subject = await this.prisma.subjects.findUnique({ where: { id: createDto.subject_id } });
    if (!subject) throw new NotFoundException('Subject not found');

    const curriculum = await this.prisma.curricula.findUnique({ where: { id: createDto.curriculum_id } });
    if (!curriculum) throw new NotFoundException('Curriculum not found');

    const booking = await this.prisma.bookings.create({
      data: {
        student_id: createDto.student_id,
        package_id: createDto.package_id,
        subject_id: createDto.subject_id,
        curriculum_id: createDto.curriculum_id,
        requested_start: new Date(createDto.requested_start),
        requested_end: new Date(createDto.requested_end),
        note: createDto.note,
        status: 'requested',
      }
    });

    // Try auto-assign a tutor
    const assigned = await this.autoAssignTutor(booking);
    // If assigned, create session record too
    if (assigned) {
      await this.prisma.sessions.create({
        data: {
          booking_id: booking.id,
          start_time: booking.requested_start,
          end_time: booking.requested_end,
          meet_link: null,
          whiteboard_link: null,
          status: 'scheduled',
        }
      });
    }

    return await this.prisma.bookings.findUnique({ where: { id: booking.id } });
  }

  // Simple auto-assignment algorithm:
  // - find active tutor whose skills include the subject (if stored in JSONB)
  // - ensure tutor has no overlapping confirmed sessions at that time
  // - fallback to any active tutor
  async autoAssignTutor(booking) {
    // naive: find tutors whose skills contain the subject canonical code OR fallback
    const tutors = await this.prisma.tutors.findMany({
      where: { is_active: true },
      include: { users: true },
      orderBy: { created_at: 'asc' }
    });

    for (const t of tutors) {
      // check overlap: any session for this tutor where times overlap and session not cancelled
      const overlapping = await this.prisma.bookings.findFirst({
        where: {
          assigned_tutor_id: t.id,
          status: { in: ['confirmed', 'requested'] },
          AND: [
            { requested_start: { lte: booking.requested_end } },
            { requested_end: { gte: booking.requested_start } },
          ]
        }
      });
      if (!overlapping) {
        // assign
        await this.prisma.bookings.update({
          where: { id: booking.id },
          data: { assigned_tutor_id: t.id, status: 'confirmed' }
        });
        return true;
      }
    }

    // no tutor found
    return false;
  }

  // Admin endpoint to reassign tutor
  async reassign(bookingId: string, tutorId: string) {
    const booking = await this.prisma.bookings.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    const tutor = await this.prisma.tutors.findUnique({ where: { id: tutorId } });
    if (!tutor) throw new NotFoundException('Tutor not found');

    const updated = await this.prisma.bookings.update({
      where: { id: bookingId },
      data: { assigned_tutor_id: tutorId, status: 'confirmed' }
    });

    // update or create session record
    const sess = await this.prisma.sessions.findFirst({ where: { booking_id: bookingId } });
    if (sess) {
      await this.prisma.sessions.update({
        where: { id: sess.id },
        data: { status: 'scheduled' }
      });
    } else {
      await this.prisma.sessions.create({
        data: {
          booking_id: bookingId,
          start_time: booking.requested_start,
          end_time: booking.requested_end,
          status: 'scheduled'
        }
      });
    }

    return updated;
  }

  // get bookings for student
  async forStudent(studentUserId: string) {
    // find student id(s) linked to this user
    const stud = await this.prisma.students.findFirst({ where: { user_id: studentUserId } });
    if (!stud) throw new NotFoundException('Student profile not found');
    return this.prisma.bookings.findMany({ where: { student_id: stud.id }, orderBy: { requested_start: 'desc' } });
  }

  // get bookings for tutor
  async forTutor(tutorUserId: string) {
    const tutor = await this.prisma.tutors.findFirst({ where: { user_id: tutorUserId } });
    if (!tutor) throw new NotFoundException('Tutor profile not found');
    return this.prisma.bookings.findMany({ where: { assigned_tutor_id: tutor.id }, orderBy: { requested_start: 'desc' } });
  }

  async forParent(parentUserId: string) {
    const students = await this.prisma.students.findMany({ where: { parent_user_id: parentUserId } });
    const ids = students.map(s => s.id);
    return this.prisma.bookings.findMany({ where: { student_id: { in: ids } }, orderBy: { requested_start: 'desc' } });
  }
}
