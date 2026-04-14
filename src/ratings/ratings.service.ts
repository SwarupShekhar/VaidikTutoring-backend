import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRatingDto } from './dto/create-rating.dto';

function gradeToNumber(grade: string | null | undefined): number {
  if (!grade) return 99;
  const g = grade.trim().toUpperCase();
  if (g === 'K') return 0;
  const n = parseInt(g, 10);
  return isNaN(n) ? 99 : n;
}

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPendingRatings(userId: string, role: string) {
    if (role === 'student') {
      const sessions = await this.prisma.sessions.findMany({
        where: {
          status: 'completed',
          tutor_ratings: { none: {} },
          bookings: {
            students: { user_id: userId },
            assigned_tutor_id: { not: null },
          },
        },
        include: {
          bookings: {
            include: {
              students: { select: { grade: true } },
              tutors: { include: { users: { select: { first_name: true, last_name: true } } } },
              subjects: { select: { name: true } },
            },
          },
        },
        orderBy: { start_time: 'desc' },
        take: 10,
      });

      return sessions
        .filter((s) => gradeToNumber(s.bookings?.students?.grade) > 3)
        .map((s) => ({
          sessionId: s.id,
          tutorId: s.bookings?.assigned_tutor_id,
          tutorName: s.bookings?.tutors
            ? `${s.bookings.tutors.users.first_name} ${s.bookings.tutors.users.last_name || ''}`.trim()
            : 'Your Tutor',
          sessionDate: s.start_time,
          subjectName: s.bookings?.subjects?.name || 'Session',
        }));
    }

    if (role === 'parent') {
      const sessions = await this.prisma.sessions.findMany({
        where: {
          status: 'completed',
          tutor_ratings: { none: {} },
          bookings: {
            students: { parent_user_id: userId },
            assigned_tutor_id: { not: null },
          },
        },
        include: {
          bookings: {
            include: {
              students: { select: { grade: true, first_name: true } },
              tutors: { include: { users: { select: { first_name: true, last_name: true } } } },
              subjects: { select: { name: true } },
            },
          },
        },
        orderBy: { start_time: 'desc' },
        take: 10,
      });

      return sessions
        .filter((s) => gradeToNumber(s.bookings?.students?.grade) <= 3)
        .map((s) => ({
          sessionId: s.id,
          tutorId: s.bookings?.assigned_tutor_id,
          tutorName: s.bookings?.tutors
            ? `${s.bookings.tutors.users.first_name} ${s.bookings.tutors.users.last_name || ''}`.trim()
            : 'Your Tutor',
          studentName: s.bookings?.students?.first_name || 'your child',
          sessionDate: s.start_time,
          subjectName: s.bookings?.subjects?.name || 'Session',
        }));
    }

    return [];
  }

  async submitRating(sessionId: string, userId: string, dto: CreateRatingDto) {
    const session = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
      include: {
        tutor_ratings: true,
        bookings: {
          include: {
            students: { select: { grade: true, user_id: true, parent_user_id: true } },
            tutors: { select: { id: true } },
          },
        },
      },
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== 'completed') throw new BadRequestException('Session is not completed yet');
    if (session.tutor_ratings.length > 0) throw new BadRequestException('Session already rated');

    const student = session.bookings?.students;
    const tutorId = session.bookings?.tutors?.id;
    if (!tutorId) throw new BadRequestException('No tutor assigned to this session');

    const gradeNum = gradeToNumber(student?.grade);
    const isStudentAccount = student?.user_id === userId;
    const isParentAccount = student?.parent_user_id === userId;

    if (gradeNum <= 3 && !isParentAccount) {
      throw new ForbiddenException('Only the parent can rate sessions for K-3 students');
    }
    if (gradeNum > 3 && !isStudentAccount) {
      throw new ForbiddenException('Only the student can rate their own sessions');
    }

    const rating = await this.prisma.tutor_ratings.create({
      data: {
        session_id: sessionId,
        tutor_id: tutorId,
        rated_by_user_id: userId,
        score: dto.score,
        comment: dto.comment ?? null,
      },
    });

    return { success: true, ratingId: rating.id };
  }

  async getTutorAverageRating(tutorId: string): Promise<{ avgScore: number | null; totalRatings: number }> {
    const result = await this.prisma.tutor_ratings.aggregate({
      where: { tutor_id: tutorId },
      _avg: { score: true },
      _count: { score: true },
    });
    return {
      avgScore: result._avg.score ? Math.round(result._avg.score * 10) / 10 : null,
      totalRatings: result._count.score,
    };
  }
}
