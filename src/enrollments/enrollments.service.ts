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
      // 1. Auto-assignment logic if tutor_id is missing
      let tutorId = dto.tutor_id;
      if (!tutorId) {
        const stud = await tx.students.findUnique({ where: { id: dto.student_id } });
        tutorId = stud?.trial_tutor_id || undefined;

        if (!tutorId) {
          const best = await tx.tutors.findFirst({
            where: { program_id: dto.program_id, is_active: true, tutor_approved: true }
          });
          tutorId = best?.id;
        }
      }

      const enrollment = await tx.enrollments.create({
        data: {
          student_id: dto.student_id,
          tutor_id: tutorId ?? undefined,
          program_id: dto.program_id,
          package_id: dto.package_id,
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
          program_id: dto.program_id,
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

    const tutors = await this.prisma.tutors.findMany({
      where: {
        program_id: student.program_id,
        is_active: true,
        tutor_approved: true,
      },
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
    const startOfNextWeek = addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), 7);

    let dayCounter = 0;
    for (const dayIndex of enrollment.schedule_days) {
      // ── CREDIT CHECK per session ──────────────────────────────────
      // Re-fetch student inside the loop so we see the latest credit
      // balance after each deduction (avoids race where all sessions
      // are created before any deduction is applied).
      const student = await prisma.students.findUnique({
        where: { id: enrollment.student_id },
      });
      if (!student) break;

      const creditsRemaining = student.subscription_credits ?? 0;
      if (creditsRemaining <= 0) {
        this.logger.warn(
          `Enrollment ${enrollment.id}: student ${enrollment.student_id} has 0 subscription credits — stopping session generation`,
        );
        // Pause the enrollment so the cron skips it next week too
        await prisma.enrollments.update({
          where: { id: enrollment.id },
          data: { status: 'paused' },
        });
        break;
      }
      // ─────────────────────────────────────────────────────────────

      let sessionStart = addDays(startOfNextWeek, dayIndex % 7);
      sessionStart = setHours(sessionStart, hours);
      sessionStart = setMinutes(sessionStart, minutes);

      const sessionEnd = new Date(sessionStart.getTime() + 60 * 60 * 1000);

      // Skip if booking already exists for this slot (prevents cron double-fire)
      const existing = await prisma.bookings.findFirst({
        where: { enrollment_id: enrollment.id, requested_start: sessionStart },
      });
      if (existing) { dayCounter++; continue; }

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

      // Deduct 1 subscription credit for this auto-scheduled session
      await prisma.students.update({
        where: { id: enrollment.student_id },
        data: { subscription_credits: { decrement: 1 } },
      });

      this.logger.log(`Scheduled session for enrollment ${enrollment.id}, deducted 1 credit (${creditsRemaining - 1} remaining)`);

      dayCounter++;
    }
  }
}
