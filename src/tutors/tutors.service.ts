import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class TutorsService {
  constructor(private prisma: PrismaService) { }

  async createTutor(data: any) {
    // Check if user exists
    const exists = await this.prisma.users.findUnique({
      where: { email: data.email },
    });

    if (exists)
      throw new ConflictException('User with this email already exists');

    // Hash password
    const hash = await bcrypt.hash(data.password, 10);

    // Create User
    const user = await this.prisma.users.create({
      data: {
        email: data.email,
        password_hash: hash,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        timezone: data.timezone,
        role: 'tutor',
      },
    });

    // Create Tutor Profile
    const tutor = await this.prisma.tutors.create({
      data: {
        user_id: user.id,
        bio: data.bio,
        qualifications: data.qualifications, // assume JSON or compatible
        skills: data.skills, // assume JSON or compatible
        hourly_rate_cents: data.hourly_rate_cents,
        employment_type: data.employment_type,
      },
    });

    return {
      message: 'Tutor created successfully',
      user,
      tutor,
    };
  }

  async getTutorStats(userId: string) {
    const tutor = await this.prisma.tutors.findFirst({
      where: { user_id: userId },
    });

    if (!tutor) return {
      todayCount: 0,
      completedCount: 0,
      totalHours: 0,
      earnings: 0,
      availableCount: 0
    };

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [todayCount, completedSessionsCount, availableJobs, totalEvents, positiveEvents, ratingAgg] = await Promise.all([
      this.prisma.bookings.count({
        where: {
          assigned_tutor_id: tutor.id,
          requested_start: {
            gte: startOfToday,
            lt: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000),
          },
          status: { not: 'archived' },
        },
      }),
      this.prisma.bookings.count({
        where: {
          assigned_tutor_id: tutor.id,
          status: 'completed',
        },
      }),
      this.prisma.bookings.count({
        where: {
          status: 'available',
        },
      }),
      this.prisma.attentionEvent.count({
        where: {
          tutorId: tutor.user_id,
        }
      }),
      this.prisma.attentionEvent.count({
        where: {
          tutorId: tutor.user_id,
          type: { in: ['PRAISE', 'EXPLANATION'] }
        }
      }),
      this.prisma.tutor_ratings.aggregate({
        where: { tutor_id: tutor.id },
        _avg: { score: true },
        _count: { score: true }
      })
    ]);

    const totalHours = completedSessionsCount;
    const earnings = (totalHours * (tutor.hourly_rate_cents || 0)) / 100;

    // Calculate REAL quality metrics
    const engagementScore = totalEvents > 0
      ? Math.min(Math.round((positiveEvents / totalEvents) * 100), 100)
      : 0;

    const reviewsCount = ratingAgg._count.score || 0;
    const averageRating = ratingAgg._avg.score || 0;

    return {
      todayCount,
      completedCount: completedSessionsCount,
      totalHours,
      earnings,
      availableCount: availableJobs,
      quality: {
        rating: averageRating,
        reviewsCount,
        engagement: engagementScore,
        punctuality: 100, // Placeholder until attendance tracking is fully implemented
        techScore: 90,    // Placeholder for now
        isInitial: totalHours === 0
      }
    };
  }

  /**
   * The tutor's students for post-session sharing: every student the tutor has
   * actually taught (a session that has occurred), each with their past sessions.
   * This is the data behind the "share notes/files" picker and mirrors the
   * server-side eligibility gate in sessions.service.shareNote.
   */
  async getMyStudents(userId: string) {
    const tutor = await this.prisma.tutors.findFirst({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!tutor) return [];

    const now = new Date();
    const bookings = await this.prisma.bookings.findMany({
      where: { assigned_tutor_id: tutor.id, student_id: { not: null } },
      include: {
        students: { select: { id: true, first_name: true, last_name: true } },
        subjects: { select: { name: true } },
        sessions: { select: { id: true, start_time: true, end_time: true, status: true } },
      },
    });

    const occurred = (b: (typeof bookings)[number], s: { status: string | null; end_time: Date | null }) => {
      if (s.status === 'cancelled') return false;
      if (s.status === 'completed') return true;
      if (s.end_time && new Date(s.end_time) < now) return true;
      if (b.requested_end && new Date(b.requested_end) < now) return true;
      return false;
    };

    const byStudent = new Map<
      string,
      { studentId: string; studentName: string; sessions: { sessionId: string; date: Date | null; subject: string }[] }
    >();

    for (const b of bookings) {
      if (!b.students) continue;
      const past = b.sessions.filter((s) => occurred(b, s));
      if (past.length === 0) continue;
      const key = b.students.id;
      if (!byStudent.has(key)) {
        byStudent.set(key, {
          studentId: b.students.id,
          studentName: `${b.students.first_name} ${b.students.last_name || ''}`.trim(),
          sessions: [],
        });
      }
      const entry = byStudent.get(key)!;
      for (const s of past) {
        entry.sessions.push({
          sessionId: s.id,
          date: s.start_time || b.requested_start,
          subject: b.subjects?.name || 'Session',
        });
      }
    }

    return [...byStudent.values()].map((e) => ({
      ...e,
      sessions: e.sessions.sort(
        (a, b) => new Date((b.date || 0) as any).getTime() - new Date((a.date || 0) as any).getTime(),
      ),
    }));
  }

  async getTutorReviews(userId: string) {
    const tutor = await this.prisma.tutors.findFirst({
      where: { user_id: userId },
    });

    if (!tutor) return [];

    return this.prisma.tutor_ratings.findMany({
      where: { tutor_id: tutor.id },
      include: {
        users: {
          select: { first_name: true, last_name: true }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 10
    });
  }

  /**
   * Update tutor's last_seen timestamp (used for online status tracking)
   * Call this when tutor accesses dashboard, performs actions, or logs in
   */
  async updateLastSeen(userId: string) {
    try {
      const tutor = await this.prisma.tutors.findFirst({
        where: { user_id: userId },
      });

      if (!tutor) return;

      await this.prisma.tutors.update({
        where: { id: tutor.id },
        data: { last_seen: new Date() },
      });
    } catch (error) {
      // Silently fail - this is a non-critical background update
      console.error(`Failed to update last_seen for user ${userId}:`, error.message);
    }
  }
}
