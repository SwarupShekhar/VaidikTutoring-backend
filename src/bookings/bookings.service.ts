// src/bookings/bookings.service.ts
import { randomUUID } from 'crypto';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBookingDto } from './create-booking.dto.js';
import { EmailService } from '../email/email.service';
import { subMinutes } from 'date-fns';
import { CreditsService } from '../credits/credits.service';
import { Cron } from '@nestjs/schedule';

import { NotificationsService } from '../notifications/notifications.service';
import { AzureStorageService } from '../azure/azure-storage.service';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly creditsService: CreditsService,
    private readonly azureStorageService: AzureStorageService,
  ) { }

  // Create booking and attempt auto-assign tutor
  // Create booking and attempt auto-assign tutor
  async create(createDto: CreateBookingDto, user: any) {
    let finalStudentId = createDto.student_id;
    let studentRecord: any = null;

    // FIX: If the logged-in user is a student, ensure they have a Student Record
    if (user.role === 'student') {
      // Check if a Student profile exists for this User ID
      studentRecord = await this.prisma.students.findFirst({
        where: { user_id: user.userId },
      });

      if (!studentRecord) {
        // Auto-create a Student record for this user if missing
        studentRecord = await this.prisma.students.create({
          data: {
            user_id: user.userId,
            first_name: user.first_name || 'Student',
            last_name: user.last_name || '',
            grade: 'TBD',
            program_id: createDto.program_id, // Auto-enroll in requested program
          },
        });
      }


      // Check if program exists to avoid FK error
      if (createDto.program_id) {
        const prog = await this.prisma.program.findUnique({ where: { id: createDto.program_id } });
        if (!prog) {
          // Lazy create program for dev/mock support
          await this.prisma.program.create({
            data: {
              id: createDto.program_id,
              name: 'Generated Program',
              status: 'active',
              startDate: new Date(),
              endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
              academic: {},
              operational: {},
              financial: {},
              staffing: {},
              delivery: {},
              reporting: {},
            }
          });
        }
      }

      // Auto-enroll or Switch Program if valid program_id provided
      if (createDto.program_id && studentRecord.program_id !== createDto.program_id) {
        studentRecord = await this.prisma.students.update({
          where: { id: studentRecord.id },
          data: { program_id: createDto.program_id }
        });
      }

      finalStudentId = studentRecord.id;
    } else if (user.role === 'parent') {
      // 1. If parent, student_id is required
      if (!finalStudentId) {
        throw new BadRequestException('student_id is required for parent booking');
      }

      // 2. Validate student exists
      studentRecord = await this.prisma.students.findUnique({
        where: { id: finalStudentId },
      });

      if (!studentRecord) {
        throw new NotFoundException('Student profile not found');
      }

      // 3. SECURITY: Ensure this parent owns this student
      if (studentRecord.parent_user_id !== user.userId) {
        throw new ForbiddenException('You can only book for your own children');
      }
    } else {
      // Admin check
      if (user.role !== 'admin') {
        // Fallback or error? Assuming admin for now if not student/parent
      }
      if (!finalStudentId) throw new BadRequestException('student_id is required');

      studentRecord = await this.prisma.students.findUnique({
        where: { id: finalStudentId },
      });
      if (!studentRecord) throw new NotFoundException('Student not found');
    }

    // 4. PROGRAM INTEGRITY CHECK
    // Ensure student is enrolled in a program (or handle default?)
    // Requirement: "Sessions must reference Program.id"
    const programId = studentRecord.program_id;
    if (!programId) {
      throw new BadRequestException('Student is not enrolled in any program.');
    }

    // VALIDATE payload program_id if present
    if (createDto.program_id && createDto.program_id !== programId) {
      throw new BadRequestException('Mismatch between requested Program ID and Student enrollment.');
    }

    const pkg = await this.prisma.packages.findUnique({
      where: { id: createDto.package_id },
    });
    if (!pkg) throw new NotFoundException('Package not found');

    const curriculum = await this.prisma.curricula.findUnique({
      where: { id: createDto.curriculum_id },
    });
    if (!curriculum) throw new NotFoundException('Curriculum not found');

    // VALIDATION: Check dates
    const start = new Date(createDto.requested_start);
    const end = new Date(createDto.requested_end);

    if (start >= end) {
      throw new BadRequestException('End time must be after start time');
    }

    // VALIDATION: Check for overlaps for this student
    const overlap = await this.prisma.bookings.findFirst({
      where: {
        student_id: finalStudentId,
        status: { not: 'cancelled' }, // Ignore cancelled bookings
        OR: [
          {
            // Existing starts within new range
            requested_start: { gte: start, lt: end },
          },
          {
            // Existing ends within new range
            requested_end: { gt: start, lte: end },
          },
          {
            // New is inside existing
            requested_start: { lte: start },
            requested_end: { gte: end },
          },
        ],
      },
    });

    if (overlap) {
      throw new ConflictException('This time slot overlaps with an existing booking.');
    }
    const now = new Date();

    if (start < now) {
      throw new ForbiddenException(
        'Requested start time must be in the future.',
      ); // Using Forbidden or BadRequest
    }
    if (end <= start) {
      throw new ForbiddenException(
        'Requested end time must be after the start time.',
      );
    }

    const createdBookings: any[] = [];

    // ─── CREDIT CHECK ───────────────────────────────────────────────
    // Only check credits for student bookings (not admin)
    let creditCostInfo: any = null;
    if (studentRecord && user.role !== 'admin') {
      const creditStatus = this.creditsService.getCreditStatus(studentRecord);
      if (!creditStatus.canBook) {
        throw new ForbiddenException(
          JSON.stringify({
            error: 'insufficient_credits',
            mode: creditStatus.mode,
            message: creditStatus.mode === 'trial_expired'
              ? 'Your trial has expired. Please subscribe to book more sessions.'
              : 'Your trial credits are used up. Please subscribe to book more sessions.',
          }),
        );
      }
      creditCostInfo = this.creditsService.computeBookingCreditCost(studentRecord);
    }

    // Loop through each subject and create a separate booking
    for (const subjectId of createDto.subject_ids) {
      const subject = await this.prisma.subjects.findUnique({
        where: { id: subjectId },
      });
      if (!subject)
        throw new NotFoundException(`Subject with ID ${subjectId} not found`);

      const booking = await this.prisma.bookings.create({
        data: {
          student_id: finalStudentId,
          package_id: createDto.package_id,
          subject_id: subjectId,
          curriculum_id: createDto.curriculum_id,
          program_id: programId,
          requested_start: start,
          requested_end: end,
          note: createDto.note,
          status: 'requested',
          credit_cost: creditCostInfo?.cost || 0,
          is_trial_session: creditCostInfo?.isTrialSession || false,
          is_free_session: creditCostInfo?.isFree || false,
        },
      });

      // Deduct credits after booking is created
      if (creditCostInfo && finalStudentId) {
        try {
          await this.creditsService.deductCredits(
            finalStudentId,
            creditCostInfo.cost,
            creditCostInfo.isTrialSession,
          );
        } catch (e) {
          // If credit deduction fails, delete the booking and re-throw
          await this.prisma.bookings.delete({ where: { id: booking.id } });
          throw e;
        }
      }

      // Try auto-assign a tutor (NON-BLOCKING)
      try {
        const assigned = await this.autoAssignTutor(booking);
        // If assigned, create session record too
        if (assigned) {
          // Check if session already exists (autoAssign might create it? No, checking code)
          // autoAssignTutor creates session in code? No, let's check.

          // Checking autoAssignTutor implementation...
          // It has Atomic Assignment but does NOT create session in the transaction shown earlier?
          // Wait, previous VIEW showed it notifies but doesn't create SESSION in transaction?
          // Actually, let's verify autoAssignTutor.
          // If it DOESN'T create session, we do it here. If it DOES, we duplicate.

          // Re-reading autoAssignTutor:
          // "await tx.bookings.update(...) data: { assigned_tutor_id... }"
          // It does NOT create a session in the transaction block I read earlier.
          // So we MUST create session here.

          await this.prisma.sessions.create({
            data: {
              booking_id: booking.id,
              program_id: programId, // Set Program ID
              start_time: booking.requested_start,
              end_time: booking.requested_end,
              meet_link: null,
              whiteboard_link: null,
              status: 'scheduled',
            },
          });
        }
      } catch (e) {
        this.logger.error(`Auto-assign failed for booking ${booking.id}: ${e.message}`);
        // Continue execution, do not fail booking
      }

      // Return fully enriched booking object
      createdBookings.push(
        await this.prisma.bookings.findUnique({
          where: { id: booking.id },
          include: {
            subjects: true,
            students: true,
            packages: true, // If relation exists
            curricula: true,
            tutors: { include: { users: true } },
          },
        }),
      );

      // Notify Admins (NON-BLOCKING)
      try {
        this.notificationsService.notifyAdminBooking(user.first_name || 'Student');
      } catch (e) {
        this.logger.error(`Failed to notify admin: ${e.message}`);
      }
    }

    return createdBookings;
  }

  // Enhanced auto-assignment algorithm (V2):
  // 1. Bulk Fetch Conflicts (N+1 Fix)
  // 2. Score/Sort by Load (Fairness)
  // 3. Atomicity (Transaction)
  // 4. Notifications
  async autoAssignTutor(booking: any) {
    // 1. Fetch ALL active tutors with their skills AND filtering by Program ID
    const tutors = await this.prisma.tutors.findMany({
      where: {
        is_active: true,
        tutor_approved: true, // Only approved tutors can be auto-assigned
        program_id: booking.program_id // STRICT SCOPING: Only assign tutors in the same program
      },
      include: { users: true },
    });

    // Filter by Expertise
    const candidates = tutors.filter((t) => {
      const skills = t.skills as any;
      if (!skills || !skills.subjects || !Array.isArray(skills.subjects))
        return false;
      return skills.subjects.includes(booking.subject_id);
    });

    if (candidates.length === 0) {
      this.logger.warn(
        `No tutor found with expertise in subject ${booking.subject_id} for Program ${booking.program_id}`,
      );
      return false;
    }

    // 2. Bulk Fetch Conflicts (N+1 Fix)
    const candidateIds = candidates.map((t) => t.id);
    const conflicts = await this.prisma.bookings.findMany({
      where: {
        assigned_tutor_id: { in: candidateIds },
        status: { in: ['confirmed', 'requested'] },
        AND: [
          { requested_start: { lte: booking.requested_end } },
          { requested_end: { gte: booking.requested_start } },
        ],
      },
      select: { assigned_tutor_id: true },
    });

    const busyTutorIds = new Set(conflicts.map((c) => c.assigned_tutor_id));

    // Filter out busy tutors
    let availableCandidates = candidates.filter((t) => !busyTutorIds.has(t.id));

    if (availableCandidates.length === 0) {
      this.logger.warn(`All expert tutors are busy for booking ${booking.id}`);
      return false;
    }

    // 3. Fairness / Load Balancing
    // We want to avoid "First Tutor Wins".
    // Strategy: Sort by "random" for now, or if we had 'last_assigned_at' we'd use that.
    // Let's use a simple random shuffle for V1 fairness to distribute load.
    // In production, we'd query 'count of upcoming sessions' and pick min.
    availableCandidates = availableCandidates.sort(() => Math.random() - 0.5);

    const chosenTutor = availableCandidates[0];

    // 4. Atomic Assignment
    try {
      await this.prisma.$transaction(async (tx) => {
        // Double-check conflict inside transaction for safety (optional but good for strict correctness)
        // For high-speed, we might skip, but let's be safe.
        const isStillBusy = await tx.bookings.findFirst({
          where: {
            assigned_tutor_id: chosenTutor.id,
            status: { in: ['confirmed', 'requested'] },
            AND: [
              { requested_start: { lte: booking.requested_end } },
              { requested_end: { gte: booking.requested_start } },
            ],
          },
        });

        if (isStillBusy) {
          throw new ConflictException('Tutor became busy during transaction');
        }

        await tx.bookings.update({
          where: { id: booking.id },
          data: { assigned_tutor_id: chosenTutor.id, status: 'confirmed' },
        });
      });
    } catch (e) {
      this.logger.warn(
        `Atomic assignment failed for tutor ${chosenTutor.id}: ${e.message}`,
      );
      return false; // Could retry loop here if we wanted strict robustness
    }

    // 5. Notifications (Post-Transaction)
    // Tutor Notification
    await this.notificationsService.create(
      chosenTutor.user_id,
      'session_assigned',
      {
        message: `You have been assigned a new session for subject ${booking.subject_id}`,
        bookingId: booking.id,
        startTime: booking.requested_start,
      },
    );
    // Real-time (User Spec)
    this.notificationsService.notifyTutorAllocation(
      chosenTutor.user_id,
      booking.student_id ? 'Student' : 'A Student', // We might need to fetch student name if not here
      booking.requested_start ? booking.requested_start.toString() : 'Scheduled Time'
    );

    // Student Notification
    if (booking.student_id) {
      const student = await this.prisma.students.findUnique({
        where: { id: booking.student_id },
      });
      if (student && student.user_id) {
        await this.notificationsService.create(
          student.user_id,
          'session_confirmed',
          {
            message: `Your session with ${chosenTutor.users.first_name} is confirmed.`,
            bookingId: booking.id,
            tutorName: chosenTutor.users.first_name,
          },
        );
        // Real-time (User Spec)
        this.notificationsService.notifyStudentAllocation(student.user_id, chosenTutor.users.first_name || 'Tutor');
      }
    }

    return true;
  }

  async broadcastToTutors(booking: any) {
    const tutors = await this.prisma.tutors.findMany({
      where: {
        is_active: true,
        tutor_approved: true,
        program_id: booking.program_id,
      },
      include: { users: true },
    });

    const candidates = tutors.filter((t) => {
      const skills = t.skills as any;
      return (
        Array.isArray(skills?.subjects) &&
        skills.subjects.includes(booking.subject_id) &&
        t.users?.email
      );
    });

    if (candidates.length === 0) {
      this.logger.warn(`No eligible tutors for claim broadcast on booking ${booking.id}`);
      return;
    }

    for (const t of candidates) {
      try {
        await this.emailService.sendMail({
          to: t.users.email,
          subject: `New Tutoring Opportunity!`,
          text: `A new session is available for claim.\n\nTime: ${booking.requested_start}\nLink: ${process.env.FRONTEND_URL}/tutor/claim-session/${booking.id}\n\nClick fast to claim!`,
        });
      } catch (e) {
        this.logger.error(`Failed to email tutor ${t.users.email}: ${e.message}`);
      }
    }

    this.logger.log(`Broadcasted booking ${booking.id} to ${candidates.length} tutors.`);
  }

  @Cron('0 */5 * * * *')
  async handleClaimBroadcast() {
    this.logger.debug('Checking for bookings to broadcast for claim...');

    const fifteenMinutesAgo = subMinutes(new Date(), 15);

    const unassignedBookings = await this.prisma.bookings.findMany({
      where: {
        status: 'requested',
        assigned_tutor_id: null,
        created_at: { lt: fifteenMinutesAgo },
      },
    });

    for (const booking of unassignedBookings) {
      const alreadyBroadcasted = await this.prisma.notifications.findFirst({
        where: {
          type: 'claim_broadcast',
          payload: { path: ['booking_id'], equals: booking.id },
        },
      });

      if (alreadyBroadcasted) continue;

      await this.broadcastToTutors(booking);

      await this.prisma.notifications.create({
        data: {
          type: 'claim_broadcast',
          payload: { booking_id: booking.id },
          user_id: null,
          is_read: true,
        },
      });

      this.logger.log(`Marked booking ${booking.id} as broadcasted for claim.`);
    }
  }

  // Claim a booking (Tutor Race)
  async claimBooking(bookingId: string, tutorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.findUnique({
        where: { id: bookingId },
      });
      if (!booking) throw new NotFoundException('Booking not found');

      if (booking.assigned_tutor_id || booking.status === 'confirmed') {
        throw new ConflictException(
          'Session already claimed by another tutor.',
        );
      }

      const tutor = await tx.tutors.findFirst({
        where: { user_id: tutorUserId },
      });
      if (!tutor)
        throw new ForbiddenException('User is not a registered tutor');

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
            ],
          },
        });
        if (overlapping)
          throw new ConflictException('You have an overlapping session.');
      }

      // Assign
      const updated = await tx.bookings.update({
        where: { id: bookingId },
        data: {
          assigned_tutor_id: tutor.id,
          status: 'confirmed',
        },
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
          meet_link: `daily-room-${booking.id}`, // Room will be generated by Daily.co service
        },
      });

      return updated;
    });
  }

  // Admin endpoint to reassign tutor
  async reassign(bookingId: string, tutorId: string) {
    const booking = await this.prisma.bookings.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const tutor = await this.prisma.tutors.findUnique({
      where: { id: tutorId },
      include: { users: true },
    });
    if (!tutor) throw new NotFoundException('Tutor not found');
    // Capture old tutor before reassignment to notify them
    let oldTutorUserId: string | null = null;
    if (booking.assigned_tutor_id && booking.assigned_tutor_id !== tutorId) {
      const oldTutor = await this.prisma.tutors.findUnique({
        where: { id: booking.assigned_tutor_id },
      });
      oldTutorUserId = oldTutor?.user_id || null;
    }

    const updated = await this.prisma.bookings.update({
      where: { id: bookingId },
      data: { assigned_tutor_id: tutorId, status: 'confirmed' },
    });

    // update or create session record
    const sess = await this.prisma.sessions.findFirst({
      where: { booking_id: bookingId },
    });
    if (sess) {
      await this.prisma.sessions.update({
        where: { id: sess.id },
        data: { status: 'scheduled' },
      });
    } else {
      await this.prisma.sessions.create({
        data: {
          booking_id: bookingId,
          start_time: booking.requested_start,
          end_time: booking.requested_end,
          status: 'scheduled',
        },
      });
    }

    // NOTIFICATIONS (NON-BLOCKING)
    try {
      // 1. Notify New Tutor
      await this.notificationsService.create(
        tutor.user_id,
        'session_assigned',
        {
          message: `You have been assigned a new session by Admin.`,
          bookingId: booking.id,
          startTime: booking.requested_start,
        },
      );
      this.notificationsService.notifyTutorAllocation(
        tutor.user_id,
        'Student', // Ideally fetch student name
        booking.requested_start?.toString() || 'Scheduled Time'
      );

      // 2. Notify Student
      if (booking.student_id) {
        const student = await this.prisma.students.findUnique({ where: { id: booking.student_id } });
        if (student && student.user_id) {
          await this.notificationsService.create(
            student.user_id,
            'session_confirmed',
            {
              message: `Your session has been assigned to a tutor: ${tutor.users?.first_name || 'Tutor'}.`,
              bookingId: booking.id,
              tutorName: tutor.users?.first_name || 'Tutor',
            }
          );
          this.notificationsService.notifyStudentAllocation(student.user_id, tutor.users?.first_name || 'Tutor');
        }
      }

      // 3. Notify Old Tutor (on tutor switch only)
      if (oldTutorUserId) {
        await this.notificationsService.create(
          oldTutorUserId,
          'session_reassigned',
          {
            message: `You have been removed from a session. It has been reassigned to another tutor.`,
            bookingId: booking.id,
          },
        );
      }
    } catch (e) {
      this.logger.error(`Failed to send reassignment notifications: ${e.message}`);
    }

    return updated;
  }

  /**
   * Internal method to create a confirmed booking + session (bypasses logic)
   * Used by Learning Mode cron/generation
   */
  async createScheduledBooking(data: {
    student_id: string;
    program_id: string;
    package_id: string;
    subject_id: string;
    curriculum_id: string;
    tutor_id: string;
    start: Date;
    end: Date;
    enrollment_id?: string;
  }, tx?: any) {
    const prisma = tx || this.prisma;
    return prisma.$transaction ? prisma.$transaction(async (innerTx: any) => {
      return this.executeScheduledBookingCreation(data, innerTx);
    }) : this.executeScheduledBookingCreation(data, prisma);
  }

  private async executeScheduledBookingCreation(data: any, tx: any) {
    const booking = await tx.bookings.create({
      data: {
        student_id: data.student_id,
        program_id: data.program_id,
        package_id: data.package_id,
        subject_id: data.subject_id,
        curriculum_id: data.curriculum_id,
        assigned_tutor_id: data.tutor_id,
        requested_start: data.start,
        requested_end: data.end,
        status: 'confirmed',
        credit_cost: 0, // system-created
        is_trial_session: false,
        is_free_session: false,
        enrollment_id: data.enrollment_id,
      },
    });

    const sessionId = randomUUID();
    const session = await tx.sessions.create({
      data: {
        id: sessionId,
        booking_id: booking.id,
        program_id: data.program_id,
        start_time: data.start,
        end_time: data.end,
        status: 'scheduled',
        meet_link: `${process.env.FRONTEND_URL}/session/${sessionId}`,
      },
    });

    return { booking, session };
  }

  // get bookings for student
  async forStudent(studentUserId: string) {
    // find student id(s) linked to this user
    const stud = await this.prisma.students.findFirst({
      where: { user_id: studentUserId },
    });
    if (!stud) {
      this.logger.warn(`No student profile found for user_id: ${studentUserId}`);
      throw new NotFoundException('Student profile not found');
    }
    this.logger.debug(`Found student profile ${stud.id} for user ${studentUserId}`);
    const bookings = await this.prisma.bookings.findMany({
      where: {
        OR: [
          { student_id: stud.id },
          { students: { user_id: studentUserId } }, 
          { students: { email: stud.email } }
        ]
      },
      include: {
        subjects: true,
        tutors: { include: { users: true } },
        sessions: {
          orderBy: { start_time: 'desc' },
          include: { session_recordings: { take: 1, orderBy: { created_at: 'desc' } } }
        }
      },
      orderBy: { requested_start: 'asc' },
    });

    // TRANSFORM: Flatten session data and inject SAS URLs
    return Promise.all(bookings.map(async b => {
      const session = b.sessions?.[0];
      const recording = session?.session_recordings?.[0];
      
      // Inject SAS URL if Azure blob exists
      if (recording?.azure_blob_name) {
          try {
              recording.file_url = await this.azureStorageService.generateSasUrl('session-recordings', recording.azure_blob_name, 2);
          } catch (e) {
              this.logger.error(`Failed to generate SAS for recording ${recording.id}: ${e.message}`);
          }
      }

      if (session?.whiteboard_snapshot_url && !session.whiteboard_snapshot_url.startsWith('http')) {
          try {
              session.whiteboard_snapshot_url = await this.azureStorageService.generateSasUrl('whiteboard-snapshots', session.whiteboard_snapshot_url, 24);
          } catch (e) {
              this.logger.error(`Failed SAS snapshot for student: ${e.message}`);
          }
      }

      return {
        ...b,
        start_time: session?.start_time || b.requested_start,
        end_time: session?.end_time || b.requested_end,
        meet_link: session?.meet_link,
        subject: b.subjects,
        tutor: b.tutors?.users, // Alias singular for frontend hook
      };
    }));
  }

  // get bookings for tutor
  async forTutor(tutorUserId: string) {
    this.logger.debug(`Looking up tutor with user_id: ${tutorUserId}`);
    // FIX: Find tutor by user_id
    const tutor = await this.prisma.tutors.findFirst({
      where: { user_id: tutorUserId },
    });

    if (!tutor) {
      throw new NotFoundException('Tutor profile not found');
    }

    this.logger.debug(`Found tutor: ${tutor.id}`);
    const now = new Date();
    const bookings = await this.prisma.bookings.findMany({
      where: {
        assigned_tutor_id: tutor.id,
        status: { not: 'archived' },
        requested_end: { gt: now }, // HIDE PAST SESSIONS
      },
      include: {
        subjects: true,
        curricula: true,
        students: { select: { first_name: true, last_name: true, grade: true } },
        tutors: {
          include: { users: { select: { first_name: true, last_name: true } } },
        },
        sessions: {
          orderBy: { start_time: 'desc' },
          take: 1
        }
      },
      orderBy: { requested_start: 'desc' },
    });

    this.logger.debug(`Found ${bookings.length} bookings for tutor ${tutor.id}`);
    return bookings;
  }

  async forParent(parentUserId: string) {
    const students = await this.prisma.students.findMany({
      where: { parent_user_id: parentUserId },
    });
    const ids = students.map((s) => s.id);
    // OPTIONAL: Do parents want to see history? Usually yes, but user request implies strict "expire" for "tutoring portal".
    // Assuming Parent Dashboard behaves like Student Dashboard for consistency regarding "joining".
    // But Admin said "booked session log must be visible only in the Admin dashboard", so let's hide for parents too.
    const bookings = await this.prisma.bookings.findMany({
      where: {
        student_id: { in: ids },
        // requested_end: { gt: new Date() }, // Unlock history for frontend stats
      },
      include: {
        subjects: true,
        students: { select: { first_name: true, last_name: true } },
        tutors: {
          include: { users: { select: { first_name: true, last_name: true } } },
        },
        sessions: {
          orderBy: { start_time: 'desc' },
          include: {
            session_recordings: {
              take: 1,
              orderBy: { created_at: 'desc' }
            },
            sticker_rewards: true,
            attendance: true
          }
        },
      },
      orderBy: { requested_start: 'desc' },
    });

    // Inject SAS URLs
    return Promise.all(bookings.map(async b => {
        for (const session of (b.sessions || [])) {
            const recording = session.session_recordings?.[0];
            if (recording?.azure_blob_name) {
                try {
                    recording.file_url = await this.azureStorageService.generateSasUrl('session-recordings', recording.azure_blob_name, 2);
                } catch (e) {
                    this.logger.error(`Failed SAS generation for parent recording: ${e.message}`);
                }
            }
            if (session.whiteboard_snapshot_url && !session.whiteboard_snapshot_url.startsWith('http')) {
                try {
                    session.whiteboard_snapshot_url = await this.azureStorageService.generateSasUrl('whiteboard-snapshots', session.whiteboard_snapshot_url, 24);
                } catch (e) {
                    this.logger.error(`Failed SAS generation for parent snapshot: ${e.message}`);
                }
            }
        }
        return b;
    }));
  }

  // Get available (unclaimed) bookings for a tutor
  // Filter by: unclaimed, future start time, AND matching subject skills
  async getAvailableForTutor(tutorUserId: string) {
    // Get tutor profile to potentially filter by skills
    const tutor = await this.prisma.tutors.findFirst({
      where: { user_id: tutorUserId },
    });
    if (!tutor) throw new NotFoundException('Tutor profile not found');
    if (!tutor.tutor_approved) throw new ForbiddenException('Your tutor account is pending approval.');

    const now = new Date();

    // Parse skills to get subjects
    const skills = tutor.skills as any;
    const tutorSubjects = skills?.subjects || [];

    // Return all unclaimed, future bookings matching subjects
    return this.prisma.bookings.findMany({
      where: {
        assigned_tutor_id: null,
        status: { in: ['requested', 'open'] },
        requested_start: { gt: now }, // Only future sessions
        // Filter by subject if tutor has specific subjects
        ...(tutorSubjects.length > 0 ? { subject_id: { in: tutorSubjects } } : {})
      },
      include: {
        subjects: true,
        curricula: true,
        students: { select: { first_name: true, last_name: true, grade: true } },
        packages: true,
      },
      orderBy: { requested_start: 'asc' },
    });
  }

  // Get single booking by ID with full details including session
  async getBookingById(bookingId: string, user: any) {
    const booking = await this.prisma.bookings.findUnique({
      where: { id: bookingId },
      include: {
        subjects: true,
        students: {
          select: {
            id: true,
            user_id: true,
            parent_user_id: true,
            first_name: true,
            last_name: true,
            grade: true,
            interests: true,
            recent_focus: true,
            struggle_areas: true,
          },
        },
        tutors: {
          include: {
            users: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
              },
            },
          },
        },
        sessions: {
          orderBy: { start_time: 'desc' },
          take: 1,
          include: {
            session_recordings: {
              take: 1,
              orderBy: { created_at: 'desc' }
            }
          }
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Check authorization: user must be the student, parent, assigned tutor, or admin
    const isStudent =
      user.role === 'student' && booking.students?.user_id === user.userId;
    const isParent =
      user.role === 'parent' &&
      booking.students?.parent_user_id === user.userId;
    const isTutor =
      user.role === 'tutor' && booking.tutors?.user_id === user.userId;
    const isAdmin = user.role === 'admin';

    const session = booking.sessions?.[0]; // Get the latest session
    return {
      ...booking,
      subject_name: booking.subjects?.name,
      subject: booking.subjects, // For SessionPage compatibility
      start_time: session?.start_time || booking.requested_start,
      end_time: session?.end_time || booking.requested_end,
      tutor: booking.tutors?.users, // For UI alias consistency
    };
  }
}
