import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnrollmentDto } from './create-enrollment.dto';
import { BookingsService } from '../bookings/bookings.service';
import { CreditsService } from '../credits/credits.service';
import { Cron } from '@nestjs/schedule';
import { addDays, setHours, setMinutes, startOfWeek } from 'date-fns';

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    private prisma: PrismaService,
    private bookingsService: BookingsService,
    private creditsService: CreditsService,
  ) {}

  async createEnrollment(dto: CreateEnrollmentDto) {
    // ── CREDIT GATE ──────────────────────────────────────────────────
    // Student must have a paid subscription with credits before they can
    // activate learning mode. This prevents the free-enrollment exploit.
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) throw new NotFoundException('Student not found');

    const creditStatus = await this.creditsService.getCreditStatus(student);
    if (!creditStatus.canBook) {
      throw new ForbiddenException(
        JSON.stringify({
          error: 'insufficient_credits',
          mode: creditStatus.mode,
          message: 'You need an active subscription to activate Learning Mode. Please purchase a plan first.',
        }),
      );
    }
    // ─────────────────────────────────────────────────────────────────

    return this.prisma.$transaction(async (tx) => {
      // Resolve program_id — required by DB but may be absent from payload
      let programId = dto.program_id;
      if (!programId) {
        const fallbackProgram = await tx.program.findFirst({ where: { status: 'active' } });
        if (!fallbackProgram) {
          throw new BadRequestException('No active program found. Please ask an admin to create a program first.');
        }
        programId = fallbackProgram.id;
      }

      // Resolve package_id from student's latest paid purchase if not provided
      let packageId = dto.package_id;
      if (!packageId) {
        const stud = await tx.students.findUnique({ where: { id: dto.student_id } });
        if (stud?.user_id) {
          const latestPurchase = await tx.purchases.findFirst({
            where: { user_id: stud.user_id, status: 'PAID' },
            orderBy: { created_at: 'desc' },
          });
          packageId = latestPurchase?.package_id ?? undefined;
        }
        if (!packageId) {
          const fallbackPkg = await tx.packages.findFirst({ where: { active: true } });
          packageId = fallbackPkg?.id ?? undefined;
        }
      }

      // 1. Auto-assignment logic if tutor_id is missing
      let tutorId = dto.tutor_id;
      if (!tutorId) {
        const stud = await tx.students.findUnique({ where: { id: dto.student_id } });
        tutorId = stud?.trial_tutor_id || undefined;

        if (!tutorId) {
          const best = await tx.tutors.findFirst({
            where: { program_id: programId, is_active: true, tutor_approved: true }
          });
          tutorId = best?.id;
        }
      }

      const enrollment = await tx.enrollments.create({
        data: {
          student_id: dto.student_id,
          tutor_id: tutorId ?? undefined,
          program_id: programId,
          package_id: packageId,
          curriculum_id: dto.curriculum_id,
          subject_ids: dto.subject_ids,
          schedule_preset: dto.schedule_preset,
          schedule_days: dto.schedule_days.map(d => parseInt(d as any)),
          start_time: dto.start_time,
          status: 'active',
        },
      });

      // 2. Update student status
      await tx.students.update({
        where: { id: dto.student_id },
        data: {
          program_id: programId,
          enrollment_status: 'learning',
        },
      });

      // 3. Generate initial sessions (credit-checked inside)
      await this.generateSessionsForEnrollment(enrollment, tx);

      return enrollment;
    });
  }

  async getTutorRecommendations(studentId: string) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });

    if (!student) throw new NotFoundException('Student not found');

    // If student has no program yet, return all active tutors
    const tutorWhere: any = { is_active: true, tutor_approved: true };
    if (student.program_id) tutorWhere.program_id = student.program_id;

    const tutors = await this.prisma.tutors.findMany({
      where: tutorWhere,
      include: { users: true },
    });

    return tutors.sort((a, b) => {
      if (a.id === student.trial_tutor_id) return -1;
      if (b.id === student.trial_tutor_id) return 1;
      return 0;
    });
  }

  @Cron('0 20 * * 0')
  async generateWeeklySessions() {
    this.logger.log('Starting weekly session generation...');
    const activeEnrollments = await this.prisma.enrollments.findMany({
      where: {
        status: 'active',
        OR: [
          { pause_until: null },
          { pause_until: { lt: new Date() } }
        ]
      },
    });

    for (const enrollment of activeEnrollments) {
      try {
        await this.generateSessionsForEnrollment(enrollment);
      } catch (e) {
        this.logger.error(`Error for enrollment ${enrollment.id}: ${e.message}`);
      }
    }
  }

  private async generateSessionsForEnrollment(enrollment: any, tx?: any) {
    const prisma = tx || this.prisma;
    const [hours, minutes] = enrollment.start_time.split(':').map(Number);
    const now = new Date();
    
    // We want to ensure sessions are scheduled for both the remainder of this week and the entirety of next week.
    // This provides immediate feedback to students who just enrolled mid-week.
    const startOfThisWeek = startOfWeek(now, { weekStartsOn: 0 });
    const startOfNextWeek = addDays(startOfThisWeek, 7);
    const targetWeeks = [startOfThisWeek, startOfNextWeek];

    let dayCounter = 0;
    for (const weekStart of targetWeeks) {
      for (const dayIndex of enrollment.schedule_days) {
        let sessionStart = addDays(weekStart, dayIndex % 7);
        sessionStart = setHours(sessionStart, hours);
        sessionStart = setMinutes(sessionStart, minutes);

        // 1. Skip if this slot is already in the past
        if (sessionStart <= now) continue;

        // 2. Skip if booking already exists for this slot (prevents double-booking during cron or manual runs)
        const existing = await prisma.bookings.findFirst({
          where: { enrollment_id: enrollment.id, requested_start: sessionStart },
        });
        if (existing) {
          dayCounter++;
          continue;
        }

        // 3. CREDIT CHECK per session
        // We re-fetch to get the most accurate current balance
        const student = await prisma.students.findUnique({
          where: { id: enrollment.student_id },
        });
        if (!student) return;

        const creditsRemaining = student.subscription_credits ?? 0;
        if (creditsRemaining <= 0) {
          this.logger.warn(
            `Enrollment ${enrollment.id}: student ${enrollment.student_id} has 0 subscription credits — stopping session generation`,
          );
          // Auto-pause if credits run dry
          await prisma.enrollments.update({
            where: { id: enrollment.id },
            data: { status: 'paused' },
          });
          return; // Exit entire generation loop
        }

        const sessionEnd = new Date(sessionStart.getTime() + 60 * 60 * 1000);
        const subjectId = enrollment.subject_ids[dayCounter % enrollment.subject_ids.length];

        await this.bookingsService.createScheduledBooking({
          student_id: enrollment.student_id,
          program_id: enrollment.program_id,
          package_id: enrollment.package_id,
          subject_id: subjectId,
          curriculum_id: enrollment.curriculum_id,
          tutor_id: enrollment.tutor_id,
          start: sessionStart,
          end: sessionEnd,
          enrollment_id: enrollment.id,
        }, tx);

        // Deduct 1 subscription credit
        await prisma.students.update({
          where: { id: enrollment.student_id },
          data: { subscription_credits: { decrement: 1 } },
        });

        this.logger.log(`Scheduled session for ${sessionStart.toISOString()} (Enrollment: ${enrollment.id}), deducted 1 credit.`);
        dayCounter++;
      }
    }
  }
}
