import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async sendStudentQuery(studentUserId: string, text: string) {
    // 1. Find student and their assigned tutor (try trial tutor first)
    const student = await this.prisma.students.findFirst({
      where: { user_id: studentUserId },
      include: {
        trial_tutor: { include: { users: true } },
        users_students_user_idTousers: true,
      },
    });

    if (!student) {
      throw new NotFoundException('Student profile not found');
    }

    let tutorId = student.trial_tutor_id;
    let tutor = student.trial_tutor;

    // Fallback 1: Try to resolve tutor from active enrollments
    if (!tutorId) {
      const activeEnrollment = await this.prisma.enrollments.findFirst({
        where: { student_id: student.id, status: 'active', NOT: { tutor_id: null } },
        include: { tutors: { include: { users: true } } },
      });
      if (activeEnrollment && activeEnrollment.tutors) {
        tutorId = activeEnrollment.tutor_id;
        tutor = activeEnrollment.tutors;
      }
    }

    // Fallback 2: Try to resolve tutor from the most recent booking with an assigned tutor
    if (!tutorId) {
      const recentBooking = await this.prisma.bookings.findFirst({
        where: { student_id: student.id, NOT: { assigned_tutor_id: null } },
        include: { tutors: { include: { users: true } } },
        orderBy: { created_at: 'desc' },
      });
      if (recentBooking && recentBooking.tutors) {
        tutorId = recentBooking.assigned_tutor_id;
        tutor = recentBooking.tutors;
      }
    }

    if (!tutorId || !tutor) {
      throw new NotFoundException('No assigned tutor found for this student');
    }

    // 2. Save message
    const message = await this.prisma.tutor_messages.create({
      data: {
        student_id: student.id,
        tutor_id: tutorId,
        sender_id: studentUserId,
        text,
      },
    });

    // 3. Notify tutor via email
    if (tutor.users?.email) {
      const tutorEmail = tutor.users.email;
      const studentName = `${student.first_name} ${student.last_name || ''}`.trim();

      try {
        await this.emailService.sendMail({
          to: tutorEmail,
          subject: `New Query from Student: ${studentName}`,
          html: `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; padding: 30px;">
              <h2 style="color: #6366f1; margin-top: 0;">New Student Query</h2>
              <p>Hello ${tutor.users.first_name || 'Tutor'},</p>
              <p>You have received a new query from your student, <strong>${studentName}</strong> (Grade ${student.grade || 'N/A'}):</p>
              <div style="background: #f8fafc; border-left: 4px solid #6366f1; padding: 20px; margin: 25px 0; font-style: italic; color: #1e293b; line-height: 1.6;">
                "${text}"
              </div>
              <p style="margin-bottom: 30px;">Please reply promptly from your tutor dashboard to maintain academic momentum.</p>
              <a href="https://studyhours.com/tutor/dashboard" style="background: #6366f1; color: white; padding: 12px 25px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Reply to Student</a>
              <p style="font-size: 12px; color: #94a3b8; margin-top: 40px; border-top: 1px solid #eee; pt: 20px;">
                StudyHours • Educational Excellence
              </p>
            </div>
          `,
        });
      } catch (e) {
        console.error('Failed to send tutor notification email:', e.message);
      }
    }

    // 4. Log event
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: studentUserId,
        action: 'SEND_STUDENT_QUERY',
        object_type: 'MESSAGE',
        object_id: message.id,
        details: { student_id: student.id, tutor_id: tutorId }
      }
    });

    return message;
  }

  async sendTutorReply(tutorUserId: string, studentId: string, text: string) {
    const tutor = await this.prisma.tutors.findFirst({
      where: { user_id: tutorUserId },
      include: { users: true }
    });

    if (!tutor) throw new NotFoundException('Tutor profile not found');

    // 1. Verify Authorization: Is this student assigned to this tutor?
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      include: { users_students_user_idTousers: true },
    });

    if (!student) throw new NotFoundException('Student not found');

    const isAssignedTrial = student.trial_tutor_id === tutor.id;
    const hasActiveEnrollment = await this.prisma.enrollments.findFirst({
      where: { student_id: studentId, tutor_id: tutor.id, status: 'active' }
    });

    if (!isAssignedTrial && !hasActiveEnrollment) {
      throw new UnauthorizedException('You are not authorized to message this student');
    }

    // 2. Save message
    const message = await this.prisma.tutor_messages.create({
      data: {
        student_id: studentId,
        tutor_id: tutor.id,
        sender_id: tutorUserId,
        text,
      },
    });

    // 3. Notify student via email
    if (student?.users_students_user_idTousers?.email) {
      const tutorName = `${tutor.users.first_name} ${tutor.users.last_name || ''}`.trim();
      try {
        await this.emailService.sendMail({
          to: student.users_students_user_idTousers.email,
          subject: `Reply from your Tutor: ${tutorName}`,
          html: `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; padding: 30px;">
              <h2 style="color: #6366f1; margin-top: 0;">New Message from StudyHours</h2>
              <p>Hi ${student.first_name},</p>
              <p>Your tutor, <strong>${tutorName}</strong>, has sent you a new message:</p>
              <div style="background: #f8fafc; border-left: 4px solid #6366f1; padding: 20px; margin: 25px 0; font-style: italic; color: #1e293b; line-height: 1.6;">
                "${text}"
              </div>
              <p style="margin-bottom: 30px;">You can view the full conversation and reply from your dashboard.</p>
              <a href="https://studyhours.com/students/dashboard" style="background: #6366f1; color: white; padding: 12px 25px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Go to Dashboard</a>
              <p style="font-size: 12px; color: #94a3b8; margin-top: 40px; border-top: 1px solid #eee; pt: 20px;">
                StudyHours • Premium Academic Support
              </p>
            </div>
          `,
        });
      } catch (e) {
        console.error('Failed to send student reply email:', e.message);
      }
    }

    // 4. Log event
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: tutorUserId,
        action: 'SEND_TUTOR_REPLY',
        object_type: 'MESSAGE',
        object_id: message.id,
        details: { tutor_id: tutor.id, student_id: studentId }
      }
    });

    return message;
  }

  async getMessages(userId: string, otherPartyId?: string) {
    // Determine if user is student or tutor
    const [student, tutor] = await Promise.all([
      this.prisma.students.findFirst({ where: { user_id: userId } }),
      this.prisma.tutors.findFirst({ where: { user_id: userId } })
    ]);

    if (student) {
      return this.prisma.tutor_messages.findMany({
        where: { student_id: student.id },
        include: {
          tutor: { include: { users: true } }
        },
        orderBy: { created_at: 'asc' },
      });
    }

    if (tutor) {
      return this.prisma.tutor_messages.findMany({
        where: { 
          tutor_id: tutor.id,
          ...(otherPartyId && { student_id: otherPartyId })
        },
        include: {
          student: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              grade: true,
              interests: true,
              struggle_areas: true,
            }
          }
        },
        orderBy: { created_at: 'asc' },
      });
    }

    return [];
  }

  async getUnreadCount(userId: string) {
     const [student, tutor] = await Promise.all([
      this.prisma.students.findFirst({ where: { user_id: userId } }),
      this.prisma.tutors.findFirst({ where: { user_id: userId } })
    ]);

    if (student) {
      return this.prisma.tutor_messages.count({
        where: { student_id: student.id, is_read: false, NOT: { sender_id: userId } }
      });
    }

    if (tutor) {
      return this.prisma.tutor_messages.count({
        where: { tutor_id: tutor.id, is_read: false, NOT: { sender_id: userId } }
      });
    }

    return 0;
  }

  async getConversations(userId: string) {
    const tutor = await this.prisma.tutors.findFirst({
      where: { user_id: userId }
    });

    if (!tutor) return [];

    // Get unique student IDs who have messaged this tutor
    const studentIds = await this.prisma.tutor_messages.groupBy({
      by: ['student_id'],
      where: { tutor_id: tutor.id }
    });

    if (studentIds.length === 0) return [];

    const studentIdsList = studentIds.map(s => s.student_id);

    // Fetch all student profiles and their latest messages in a single query per student profile via relation include
    const [studentsWithLatestMessage, unreadCounts] = await Promise.all([
      this.prisma.students.findMany({
        where: { id: { in: studentIdsList } },
        include: {
          tutor_messages: {
            where: { tutor_id: tutor.id },
            orderBy: { created_at: 'desc' },
            take: 1
          }
        }
      }),
      this.prisma.tutor_messages.groupBy({
        by: ['student_id'],
        where: {
          tutor_id: tutor.id,
          student_id: { in: studentIdsList },
          is_read: false,
          NOT: { sender_id: userId }
        },
        _count: { id: true }
      })
    ]);

    const unreadMap = new Map<string, number>(
      unreadCounts.map(u => [u.student_id, u._count.id])
    );

    const enriched = studentsWithLatestMessage.map((s) => {
      const lastMessage = s.tutor_messages[0];
      const unreadCount = unreadMap.get(s.id) ?? 0;
      const { tutor_messages, ...studentData } = s;

      return {
        ...(lastMessage || {}),
        student: studentData,
        unreadCount
      };
    });

    // Sort by latest message date
    return enriched.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeB - timeA;
    });
  }

  async markAsRead(userId: string, otherPartyId: string) {
    const [student, tutor] = await Promise.all([
      this.prisma.students.findFirst({ where: { user_id: userId } }),
      this.prisma.tutors.findFirst({ where: { user_id: userId } })
    ]);

    if (student) {
       await this.prisma.tutor_messages.updateMany({
         where: { student_id: student.id, is_read: false, NOT: { sender_id: userId } },
         data: { is_read: true }
       });
    } else if (tutor) {
       await this.prisma.tutor_messages.updateMany({
         where: { tutor_id: tutor.id, student_id: otherPartyId, is_read: false, NOT: { sender_id: userId } },
         data: { is_read: true }
       });
    }
  }
}
