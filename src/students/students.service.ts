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
      email?: string;
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
      throw new BadRequestException('You can only add up to 10 students.');
    }

    // 0. Check for duplicates (by email if provided, or name and parent)
    if (data.email) {
      const existingByEmail = await this.prisma.students.findUnique({
        where: { email: data.email },
      });
      if (existingByEmail) {
        throw new BadRequestException('A student with this email already exists.');
      }
    }

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
        email: data.email,
        grade: data.grade,
        school: data.school,
        curriculum_preference: data.curriculum_preference,
        interests: data.interests || [],
        recent_focus: data.recent_focus || '',
        struggle_areas: data.struggle_areas || [],
      },
    });
  }

  async update(
    studentId: string,
    data: {
      first_name?: string;
      last_name?: string;
      email?: string;
      grade?: string;
      school?: string;
      interests?: string[];
      recent_focus?: string;
      struggle_areas?: string[];
    },
    userId: string,
    userRole: string
  ) {
    // 1. Verify existence
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // 2. Authorization: Parent owns student OR Student IS the student
    const isParentOwner = student.parent_user_id === userId;
    const isStudentSelf = student.user_id === userId;

    if (!isParentOwner && !isStudentSelf && userRole !== 'admin') {
      throw new BadRequestException('Not authorized to update this profile');
    }

    // 3. Update
    return this.prisma.students.update({
      where: { id: studentId },
      data: {
        ...(data.first_name && { first_name: data.first_name }),
        ...(data.last_name && { last_name: data.last_name }),
        ...(data.grade && { grade: data.grade }),
        ...(data.school && { school: data.school }),
        ...(data.interests && { interests: data.interests }),
        ...(data.recent_focus && { recent_focus: data.recent_focus }),
        ...(data.struggle_areas && { struggle_areas: data.struggle_areas }),
      },
    });
  }

  async findUniqueById(id: string) {
    return this.prisma.students.findUnique({
      where: { id },
      include: {
        bookings: {
          select: { id: true, package_id: true, assigned_tutor_id: true },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findByUserId(userId: string) {
    const student = await this.prisma.students.findFirst({
      where: { user_id: userId },
      include: {
        bookings: {
          include: {
            sessions: {
              include: {
                sticker_rewards: true
              }
            }
          }
        }
      }
    });
    
    if (!student) return null;

    // Flatten stickers
    const stickers = student.bookings.flatMap(b => b.sessions.flatMap(s => s.sticker_rewards.map(r => r.sticker)));

    return {
        ...student,
        stickers
    };
  }

  async getEnrollmentStatus(studentId: string) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      include: {
        bookings: {
          where: { status: { in: ['approved', 'confirmed', 'completed'] } },
          include: { tutors: { include: { users: true } }, sessions: true },
          orderBy: { requested_start: 'asc' },
        },
      },
    });

    if (!student) throw new NotFoundException('Student not found');

    // Build weekly schedule from upcoming bookings
    const now = new Date();
    const weeklySchedule = student.bookings
      .filter(b => b.requested_start && b.requested_start > now)
      .slice(0, 7)
      .map(b => ({
        bookingId: b.id,
        date: b.requested_start,
        end: b.requested_end,
        tutorName: b.tutors?.users
          ? `${b.tutors.users.first_name} ${b.tutors.users.last_name || ''}`.trim()
          : null,
      }));

    const assignedTutorId = student.bookings.find(b => b.assigned_tutor_id)?.assigned_tutor_id ?? null;

    return {
      status: student.enrollment_status,
      sessionsRemaining: student.sessions_remaining,
      packageEndDate: student.package_end_date,
      assignedTutorId,
      weeklySchedule,
    };
  }

  async getProgressSummary(studentId: string) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      include: {
        bookings: {
          include: {
            sessions: {
              include: {
                bookings: { include: { subjects: true } },
                session_recordings: { take: 1, orderBy: { created_at: 'desc' } }
              }
            },
            subjects: true
          }
        }
      }
    });

    if (!student) throw new NotFoundException('Student not found');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get all sessions
    const allSessions = student.bookings.flatMap(b => b.sessions);
    
    // A session is "effectively completed" if:
    // 1. status === 'completed'  OR
    // 2. end_time exists and is in the past  OR
    // 3. The parent booking has a past end date and the session is not cancelled
    const isEffectivelyCompleted = (s: any) => {
      if (s.status === 'completed') return true;
      if (s.status === 'cancelled') return false;
      if (s.end_time && new Date(s.end_time) < now) return true;
      // Check booking dates as fallback
      const booking = student.bookings.find(b => b.sessions.some(sess => sess.id === s.id));
      if (booking?.requested_end && new Date(booking.requested_end) < now) return true;
      return false;
    };

    const completedSessions = allSessions.filter(isEffectivelyCompleted);
    const totalSessions = completedSessions.length;
    
    // Auto-fix: mark past sessions as completed in DB (fire-and-forget)
    const needsFix = completedSessions.filter(s => s.status !== 'completed');
    if (needsFix.length > 0) {
      this.prisma.sessions.updateMany({
        where: { id: { in: needsFix.map(s => s.id) } },
        data: { status: 'completed' }
      }).catch(() => {}); // fire-and-forget
    }
    
    // Sessions this month
    const sessionsThisMonth = completedSessions.filter(s => {
      const t = s.start_time || s.created_at;
      return t && new Date(t) >= startOfMonth;
    }).length;

    // Attendance rate (last 30 days)
    const scheduledLast30 = allSessions.filter(s => {
      const t = s.start_time || s.created_at;
      return t && new Date(t) >= thirtyDaysAgo;
    }).length;
    
    const completedLast30 = completedSessions.filter(s => {
      const t = s.start_time || s.created_at;
      return t && new Date(t) >= thirtyDaysAgo;
    }).length;

    const attendanceRate = scheduledLast30 === 0 ? 100 : Math.round((completedLast30 / scheduledLast30) * 100);

    // Calculate total hours dynamically
    let dynamicHours = 0;
    completedSessions.forEach(s => {
      if (s.start_time && s.end_time) {
        dynamicHours += (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3600000;
      } else {
        // Fallback: check booking duration
        const booking = student.bookings.find(b => b.sessions.some(sess => sess.id === s.id));
        if (booking?.requested_start && booking?.requested_end) {
          dynamicHours += (new Date(booking.requested_end).getTime() - new Date(booking.requested_start).getTime()) / 3600000;
        } else {
          dynamicHours += 1; // Default assumption: 1 hour per session
        }
      }
    });
    // Use whichever is higher: stored value or dynamically calculated
    const totalHoursLearned = Math.max(student.total_hours_learned || 0, dynamicHours);

    // Topics this month (from tutor notes)
    const notesThisMonth = allSessions
      .filter(s => s.tutor_note && (s.start_time || s.created_at) && new Date((s.start_time || s.created_at)!).getTime() >= startOfMonth.getTime())
      .map(s => s.tutor_note as string);
    
    let topicsThisMonth: string[] = [];
    notesThisMonth.forEach(note => {
      const parts = note.split(/[.,]/).map(p => p.trim()).filter(p => p.length > 0);
      topicsThisMonth.push(...parts);
    });
    topicsThisMonth = [...new Set(topicsThisMonth)].slice(0, 8);

    // Subject Progress
    const subjectStats: Record<string, { completed: number, improving: number, needsWork: number }> = {};
    
    completedSessions.forEach(s => {
      const subject = s.bookings?.subjects?.name || 'Unknown';
      if (!subjectStats[subject]) subjectStats[subject] = { completed: 0, improving: 0, needsWork: 0 };
      
      subjectStats[subject].completed++;
      
      const note = (s.tutor_note || '').toLowerCase();
      if (note.includes('improved') || note.includes('great') || note.includes('excellent')) {
        subjectStats[subject].improving++;
      } else if (note.includes('struggle') || note.includes('difficult') || note.includes('needs work')) {
        subjectStats[subject].needsWork++;
      }
    });

    const subjectProgress = Object.entries(subjectStats).map(([subject, stats]) => {
      let level: 'improving' | 'steady' | 'needs_work' = 'steady';
      if (stats.needsWork > 0) level = 'needs_work';
      else if (stats.improving > 0) level = 'improving';
      
      return { subject, level };
    });

    // Package info
    let packageSessionsTotal = student.subscription_credits || 0;
    const credits = await this.prisma.user_credits.findFirst({
        where: { user_id: student.user_id || undefined }
    });
    if (credits) {
        packageSessionsTotal = credits.credits_total;
    }

    // Fetch stickers
    const stickers = await this.prisma.sticker_rewards.findMany({
      where: { session_id: { in: allSessions.map(s => s.id) } },
      select: { sticker: true, given_at: true }
    });

    // Recent tutor feedback (last 5 sessions with notes)
    const recentFeedback = completedSessions
      .filter(s => s.tutor_note)
      .sort((a, b) => new Date((b.start_time || b.created_at || 0) as any).getTime() - new Date((a.start_time || a.created_at || 0) as any).getTime())
      .slice(0, 5)
      .map(s => ({
        sessionId: s.id,
        date: s.start_time || s.created_at,
        subject: s.bookings?.subjects?.name || 'Session',
        note: s.tutor_note,
      }));

    // Recent recordings (last 5 sessions with recordings or whiteboard snapshots)
    const recentRecordings = completedSessions
      .filter(s => s.session_recordings?.length > 0 || s.whiteboard_snapshot_url)
      .sort((a, b) => new Date((b.start_time || b.created_at || 0) as any).getTime() - new Date((a.start_time || a.created_at || 0) as any).getTime())
      .slice(0, 5)
      .map(s => ({
        sessionId: s.id,
        date: s.start_time || s.created_at,
        subject: s.bookings?.subjects?.name || 'Session',
        recordingId: s.session_recordings[0]?.id || null,
        blobName: s.session_recordings[0]?.azure_blob_name || null,
        hasWhiteboardSnapshot: !!s.whiteboard_snapshot_url,
      }));

    // --- Badge Logic ---
    const earnedBadges = [...(student.badges || [])];
    const hasBadge = (id: string) => earnedBadges.includes(id);
    
    // 1. First Step: 1 session
    if (totalSessions >= 1 && !hasBadge('first_step')) earnedBadges.push('first_step');
    // 2. Consistent: 5 sessions
    if (totalSessions >= 5 && !hasBadge('consistent')) earnedBadges.push('consistent');
    // 3. Quick Learner: 10 hours
    if (totalHoursLearned >= 10 && !hasBadge('quick_learner')) earnedBadges.push('quick_learner');
    // 4. Dedicated: 4 week streak
    if (student.streak_weeks >= 4 && !hasBadge('dedicated')) earnedBadges.push('dedicated');
    // 5. Star Student: 5 stickers
    if (stickers.length >= 5 && !hasBadge('star_student')) earnedBadges.push('star_student');

    // Update DB if new badges earned (fire-and-forget)
    if (earnedBadges.length > (student.badges?.length || 0)) {
       this.prisma.students.update({
         where: { id: studentId },
         data: { badges: earnedBadges }
       }).catch(() => {});
    }

    return {
      streakWeeks: student.streak_weeks,
      totalSessions,
      totalHoursLearned,
      sessionsThisMonth,
      attendanceRate,
      packageSessionsRemaining: student.sessions_remaining,
      packageSessionsTotal,
      badges: earnedBadges,
      stickers: stickers.map(s => s.sticker),
      topicsThisMonth,
      subjectProgress,
      recentFeedback,
      recentRecordings,
    };
  }

  async updateStreak(studentId: string) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId }
    });
    if (!student) throw new NotFoundException('Student not found');

    const now = new Date();
    // ISO week string: YYYY-Www
    const getISOWeek = (date: Date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 4 - (d.getDay() || 7));
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return `${d.getFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
    };

    const currentWeek = getISOWeek(now);
    const lastWeek = student.last_session_week;

    if (lastWeek === currentWeek) {
        return student;
    }

    let newStreak = student.streak_weeks;
    
    if (!lastWeek) {
        newStreak = 1;
    } else {
        const prevWeekDate = new Date(now);
        prevWeekDate.setDate(prevWeekDate.getDate() - 7);
        const prevWeek = getISOWeek(prevWeekDate);
        
        if (lastWeek === prevWeek) {
            newStreak += 1;
        } else {
            newStreak = 1;
        }
    }

    return this.prisma.students.update({
      where: { id: studentId },
      data: {
        streak_weeks: newStreak,
        last_session_week: currentWeek
      }
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

  async getStudentNotes(userId: string) {
    const student = await this.prisma.students.findFirst({
      where: { user_id: userId },
      include: {
        bookings: {
          include: { sessions: true },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    // If user is a parent, find ALL their students' notes
    const parent = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { students_students_parent_user_idTousers: true }
    });

    let studentIds: string[] = [];
    if (student) {
      studentIds = [student.id];
    } else if (parent && parent.students_students_parent_user_idTousers.length > 0) {
      studentIds = parent.students_students_parent_user_idTousers.map(s => s.id);
    } else {
      throw new NotFoundException('Student or Parent profile not found');
    }

    const bookings = await this.prisma.bookings.findMany({
      where: { student_id: { in: studentIds } },
      include: { sessions: true }
    });

    const sessionIds = bookings.flatMap(b => b.sessions.map(s => s.id));

    return this.prisma.class_notes.findMany({
      where: { session_id: { in: sessionIds } },
      orderBy: { created_at: 'desc' },
      include: {
        users: { select: { first_name: true, last_name: true } },
        sessions: {
          select: {
            id: true,
            start_time: true,
            bookings: { select: { subjects: { select: { name: true } } } },
          },
        },
      },
    });
  }

  async getStudentSessions(userId: string) {
    const student = await this.prisma.students.findFirst({
      where: { user_id: userId },
      include: {
        bookings: {
          include: {
            subjects: true,
            sessions: {
              include: {
                session_recordings: { take: 1, orderBy: { created_at: 'desc' } },
              },
              orderBy: { start_time: 'desc' },
            },
          },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    return student.bookings.flatMap(b =>
      b.sessions.map(s => ({
        sessionId: s.id,
        subject: b.subjects?.name || 'Session',
        startTime: s.start_time,
        endTime: s.end_time,
        status: s.status,
        hasRecording: s.session_recordings.length > 0,
        recordingId: s.session_recordings[0]?.id || null,
        hasWhiteboardSnapshot: !!s.whiteboard_snapshot_url,
        tutorNote: s.tutor_note,
      }))
    );
  }
}
