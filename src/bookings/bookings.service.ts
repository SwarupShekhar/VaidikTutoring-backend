// src/bookings/bookings.service.ts
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBookingDto } from './create-booking.dto.js';
import { EmailService } from '../email/email.service';
import { subMinutes } from 'date-fns';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly emailService: EmailService
  ) { }

  // Create booking and attempt auto-assign tutor
  // Create booking and attempt auto-assign tutor
  async create(createDto: CreateBookingDto, user: any) {
    let finalStudentId = createDto.student_id;

    // FIX: If the logged-in user is a student, ensure they have a Student Record
    if (user.role === 'student') {
      // Check if a Student profile exists for this User ID
      // In our schema, students are linked via user_id
      const existingStudent = await this.prisma.students.findFirst({
        where: { user_id: user.sub } // user.sub is the ID from JWT
      });

      if (!existingStudent) {
        // Auto-create a Student record for this user if missing
        const newStudent = await this.prisma.students.create({
          data: {
            user_id: user.sub,
            first_name: user.first_name || 'Student',
            last_name: user.last_name || '',
            grade: 'TBD',
            // We do not set parent_user_id here as they are self-registered
          }
        });
        finalStudentId = newStudent.id;
      } else {
        finalStudentId = existingStudent.id;
      }
    } else {
      // For parents, validate the passed student_id exists
      const studentExists = await this.prisma.students.findUnique({ where: { id: finalStudentId } });
      if (!studentExists) {
        throw new NotFoundException('Student profile not found for the provided ID');
      }
    }

    const pkg = await this.prisma.packages.findUnique({ where: { id: createDto.package_id } });
    if (!pkg) throw new NotFoundException('Package not found');

    const curriculum = await this.prisma.curricula.findUnique({ where: { id: createDto.curriculum_id } });
    if (!curriculum) throw new NotFoundException('Curriculum not found');

    // VALIDATION: Check dates
    const start = new Date(createDto.requested_start);
    const end = new Date(createDto.requested_end);
    const now = new Date();

    if (start < now) {
      throw new ForbiddenException('Requested start time must be in the future.'); // Using Forbidden or BadRequest
    }
    if (end <= start) {
      throw new ForbiddenException('Requested end time must be after the start time.');
    }

    const createdBookings: any[] = [];

    // Loop through each subject and create a separate booking
    for (const subjectId of createDto.subject_ids) {
      const subject = await this.prisma.subjects.findUnique({ where: { id: subjectId } });
      if (!subject) throw new NotFoundException(`Subject with ID ${subjectId} not found`);

      const booking = await this.prisma.bookings.create({
        data: {
          student_id: finalStudentId,
          package_id: createDto.package_id,
          subject_id: subjectId,
          curriculum_id: createDto.curriculum_id,
          requested_start: start,
          requested_end: end,
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

      // Return fully enriched booking object
      createdBookings.push(
        await this.prisma.bookings.findUnique({
          where: { id: booking.id },
          include: {
            subjects: true,
            students: true,
            packages: true,
            curricula: true,
            tutors: { include: { users: true } }
          }
        })
      );
    }

    return createdBookings;
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

    // no tutor found - BROADCAST TO ALL
    await this.broadcastToTutors(booking, tutors);
    return false;
  }

  async broadcastToTutors(booking, tutors) {
    // Filter tutors who technically COULD take it (ignoring overlaps for now, or maybe check them)
    // For MVP, just blast everyone or filter by subject match if possible.

    // We assume tutors list is passed or we fetch it.

    const candidates = tutors.filter(t => t.users && t.users.email); // Ensure email exists

    for (const t of candidates) {
      // In real app: check t.skills for booking.subject_id match
      // and check overlaps again? Or just let them race.

      try {
        await this.emailService.sendMail({
          to: t.users.email,
          subject: `New Tutoring Opportunity!`,
          text: `A new session is available for claim.\n\nTime: ${booking.requested_start}\nLink: ${process.env.FRONTEND_URL}/tutor/claim-session/${booking.id}\n\nClick fast to claim!`
        });
      } catch (e) {
        this.logger.error(`Failed to email tutor ${t.users.email}: ${e.message}`);
      }
    }
    this.logger.log(`Broadcasted booking ${booking.id} to ${candidates.length} tutors.`);
  }

  // Claim a booking (Tutor Race)
  async claimBooking(bookingId: string, tutorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.findUnique({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException('Booking not found');

      if (booking.assigned_tutor_id || booking.status === 'confirmed') {
        throw new ConflictException('Session already claimed by another tutor.');
      }

      const tutor = await tx.tutors.findFirst({ where: { user_id: tutorUserId } });
      if (!tutor) throw new ForbiddenException('User is not a registered tutor');

      // Check overlaps again for this specific tutor
      // (Simplified: assuming if we are here, we can claim. OR verify overlaps)
      // For now, let's allow overlapping claims but warn? No, block.
      // We must handle Date | null logic carefully.
      if (booking.requested_start && booking.requested_end) {
        const overlapping = await tx.bookings.findFirst({
          where: {
            assigned_tutor_id: tutor.id,
            status: { in: ['confirmed', 'requested'] },
            AND: [
              { requested_start: { lte: booking.requested_end } },
              { requested_end: { gte: booking.requested_start } },
            ]
          }
        });
        if (overlapping) throw new ConflictException('You have an overlapping session.');
      }


      // Assign
      const updated = await tx.bookings.update({
        where: { id: bookingId },
        data: {
          assigned_tutor_id: tutor.id,
          status: 'confirmed'
        }
      });

      // Create/Update Session
      // (Usually broadcast leaves it 'requested' without session, or 'open'?)
      // If session doesn't exist, create it.
      await tx.sessions.create({
        data: {
          booking_id: booking.id,
          start_time: booking.requested_start ?? new Date(),
          end_time: booking.requested_end ?? new Date(Date.now() + 3600000),
          status: 'scheduled',
          meet_link: `https://meet.jit.si/k12-${booking.id}` // auto-gen link
        }
      });

      return updated;
    });
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
    return this.prisma.bookings.findMany({
      where: { student_id: stud.id },
      include: {
        subjects: true,
        tutors: { include: { users: true } }
      },
      orderBy: { requested_start: 'asc' }
    });
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

  // Get available (unclaimed) bookings for a tutor
  // Optionally filter by tutor's skills/subjects
  async getAvailableForTutor(tutorUserId: string) {
    // Get tutor profile to potentially filter by skills
    const tutor = await this.prisma.tutors.findFirst({ where: { user_id: tutorUserId } });
    if (!tutor) throw new NotFoundException('Tutor profile not found');

    // MVP: Return all unclaimed bookings (status = 'requested' and no assigned tutor)
    // Future: Filter by tutor.skills matching booking.subject_id
    return this.prisma.bookings.findMany({
      where: {
        assigned_tutor_id: null,
        status: { in: ['requested', 'open'] },
      },
      include: {
        subjects: true,
        students: { select: { first_name: true, last_name: true } },
        packages: true,
      },
      orderBy: { requested_start: 'asc' },
    });
  }
}
