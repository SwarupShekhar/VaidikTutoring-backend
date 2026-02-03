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

    const [todayCount, completedSessions, availableJobs, attentionEvents] = await Promise.all([
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
      this.prisma.bookings.findMany({
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
      this.prisma.attentionEvent.findMany({
        where: {
          tutorId: tutor.user_id,
        }
      })
    ]);

    const totalHours = completedSessions.length;
    const earnings = (totalHours * (tutor.hourly_rate_cents || 0)) / 100;

    // Calculate REAL quality metrics
    const totalEvents = attentionEvents.length;
    const engagementScore = totalEvents > 0
      ? Math.min(Math.round((attentionEvents.filter(e => ['PRAISE', 'EXPLANATION'].includes(e.type)).length / totalEvents) * 100), 100)
      : 0;

    return {
      todayCount,
      completedCount: completedSessions.length,
      totalHours,
      earnings,
      availableCount: availableJobs,
      quality: {
        rating: 5.0, // Default for now until Review system is built
        reviewsCount: 0,
        engagement: engagementScore,
        punctuality: 100, // Placeholder until attendance tracking is fully implemented
        techScore: 90,    // Placeholder for now
        isInitial: totalHours === 0
      }
    };
  }
}
