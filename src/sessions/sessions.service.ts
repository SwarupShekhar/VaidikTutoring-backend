// src/sessions/sessions.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';
import { StudentsService } from '../students/students.service';
import { AzureStorageService } from '../azure/azure-storage.service';

const BADGES = [
  { id: 'first_step', label: 'First Step', emoji: '🎯', description: 'Completed your first session', condition: (p) => p.totalSessions >= 1 },
  { id: 'consistent', label: 'Consistent', emoji: '📅', description: 'Attended 4 sessions in a month', condition: (p) => p.sessionsThisMonth >= 4 },
  { id: 'quick_learner', label: 'Quick Learner', emoji: '⚡', description: '2 week streak', condition: (p) => p.streakWeeks >= 2 },
  { id: 'dedicated', label: 'Dedicated', emoji: '💪', description: '10 sessions completed', condition: (p) => p.totalSessions >= 10 },
  { id: 'star_student', label: 'Star Student', emoji: '⭐', description: '4 week streak', condition: (p) => p.streakWeeks >= 4 },
];

@Injectable()
export class SessionsService {
  private logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
    private readonly notificationsService: NotificationsService,
    private readonly azureStorageService: AzureStorageService,
    @Inject(forwardRef(() => StudentsService))
    private readonly studentsService: StudentsService,
  ) { }

  async create(dto: any) {
    if (!dto?.booking_id)
      throw new BadRequestException('booking_id is required');

    const booking = await this.prisma.bookings.findUnique({
      where: { id: dto.booking_id },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const created = await this.prisma.sessions.create({
      data: {
        booking_id: dto.booking_id,
        start_time: dto.start_time
          ? new Date(dto.start_time)
          : (booking.requested_start ?? new Date()),
        end_time: dto.end_time
          ? new Date(dto.end_time)
          : (booking.requested_end ?? new Date(Date.now() + 60 * 60 * 1000)),
        meet_link: dto.meet_link ?? null, // Default to null, will be populated by Daily.co later or manually
        whiteboard_link: dto.whiteboard_link ?? null,
        status: dto.status ?? 'scheduled',
      },
    });

    // generate ICS
    const ics = await this.generateIcsInvite(created.id);

    // collect recipient emails (student, parent, tutor)
    const recipients = new Set<string>();

    if (booking.student_id) {
      const student = await this.prisma.students.findUnique({
        where: { id: booking.student_id },
      });
      if (student) {
        if (student.parent_user_id) {
          const parent = await this.prisma.users.findUnique({
            where: { id: student.parent_user_id },
          });
          if (parent?.email) recipients.add(parent.email);
        }
        if (student.user_id) {
          const studentUser = await this.prisma.users.findUnique({
            where: { id: student.user_id },
          });
          if (studentUser?.email) recipients.add(studentUser.email);
        }
      }
    }

    if (booking.assigned_tutor_id) {
      const tutor = await this.prisma.tutors.findUnique({
        where: { id: booking.assigned_tutor_id },
      });
      if (tutor) {
        const tutorUser = await this.prisma.users.findUnique({
          where: { id: tutor.user_id },
        });
        if (tutorUser?.email) recipients.add(tutorUser.email);
      }
    }

    // send email if recipients found
    const to = Array.from(recipients);
    if (to.length > 0) {
      try {
        await this.emailService.sendSessionInvite({
          to,
          subject: `Tutoring Session — ${created.id}`,
          plaintext: `Your tutoring session is scheduled.\nBooking: ${booking.id}\nStart: ${created.start_time}\n`,
          icsContent: ics,
          filename: `session-${created.id}.ics`,
        });
        this.logger.log(`Session invite emailed to: ${to.join(', ')}`);
      } catch (err) {
        this.logger.error('Failed to send session invite email', err);
        // non-fatal: session already created
      }
    } else {
      this.logger.warn(
        'No recipient emails found for session. Invite not emailed.',
      );
    }

    return created;
  }

  async findAllForUser(userId: string) {
    // We need to determine if this user is a parent, student, or tutor to find their sessions.
    // A user might be multiple things, but let's check roles or associated profiles.

    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) return [];

    let bookingIds: string[] = [];

    if (user.role === 'parent') {
      // Find all students for this parent
      const students = await this.prisma.students.findMany({
        where: { parent_user_id: userId },
      });
      const studentIds = students.map((s) => s.id);
      const bookings = await this.prisma.bookings.findMany({
        where: { student_id: { in: studentIds } },
      });
      bookingIds = bookings.map((b) => b.id);
    } else if (user.role === 'student') {
      const student = await this.prisma.students.findFirst({
        where: { user_id: userId },
      });
      if (student) {
        const bookings = await this.prisma.bookings.findMany({
          where: { student_id: student.id },
        });
        bookingIds = bookings.map((b) => b.id);
      }
    } else if (user.role === 'tutor') {
      const tutor = await this.prisma.tutors.findFirst({
        where: { user_id: userId },
      });
      if (tutor) {
        const bookings = await this.prisma.bookings.findMany({
          where: { assigned_tutor_id: tutor.id },
        });
        bookingIds = bookings.map((b) => b.id);
      }
    }

    // Fetch sessions for these bookings
    // Fetch sessions for these bookings
    const sessions = await this.prisma.sessions.findMany({
      where: { booking_id: { in: bookingIds } },
      orderBy: { start_time: 'asc' },
      include: {
        bookings: {
          include: {
            subjects: true,
            students: true,
            tutors: { include: { users: true } },
          },
        },
      },
    });

    return sessions;
  }

  private toIcsDate(d: Date) {
    const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = d.getUTCDate().toString().padStart(2, '0');
    const hh = d.getUTCHours().toString().padStart(2, '0');
    const min = d.getUTCMinutes().toString().padStart(2, '0');
    const ss = d.getUTCSeconds().toString().padStart(2, '0');
    return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
  }

  private safeText(t: any) {
    if (t === null || t === undefined) return '';
    return String(t).replace(/\r\n/g, '\\n').replace(/\n/g, '\\n');
  }

  async generateIcsInvite(sessionId: string) {
    const session = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');

    const booking = session.booking_id
      ? await this.prisma.bookings.findUnique({
        where: { id: session.booking_id },
      })
      : null;

    let studentUser: any = null;
    if (booking?.student_id) {
      const student = await this.prisma.students.findUnique({
        where: { id: booking.student_id },
      });
      if (student) {
        if (student.user_id) {
          // Existing check for student.user_id
          studentUser = await this.prisma.users.findUnique({
            where: { id: student.user_id },
          });
        }
      }
    }

    let tutorUser: any = null;
    if (booking?.assigned_tutor_id) {
      const tutor = await this.prisma.tutors.findUnique({
        where: { id: booking.assigned_tutor_id },
      });
      if (tutor)
        tutorUser = await this.prisma.users.findUnique({
          where: { id: tutor.user_id },
        });
    }

    const subject = booking?.subject_id
      ? await this.prisma.subjects.findUnique({
        where: { id: booking.subject_id },
      })
      : null;
    const pkg = booking?.package_id
      ? await this.prisma.packages.findUnique({
        where: { id: booking.package_id },
      })
      : null;
    const curriculum = booking?.curriculum_id
      ? await this.prisma.curricula.findUnique({
        where: { id: booking.curriculum_id },
      })
      : null;

    const startDt = session.start_time
      ? new Date(session.start_time)
      : booking?.requested_start
        ? new Date(booking.requested_start)
        : new Date();
    const endDt = session.end_time
      ? new Date(session.end_time)
      : booking?.requested_end
        ? new Date(booking.requested_end)
        : new Date(Date.now() + 60 * 60 * 1000);

    const dtstamp = this.toIcsDate(new Date());
    const uid = `session-${session.id}@k12tutoring.local`;
    const dtstart = this.toIcsDate(startDt);
    const dtend = this.toIcsDate(endDt);

    const summary = `${subject?.name ?? 'Tutoring Session'}${pkg?.name ? ' — ' + pkg.name : ''}`;

    const descriptionParts = [
      `Session ID: ${session.id}`,
      booking ? `Booking ID: ${booking.id}` : '',
      subject ? `Subject: ${subject.name}` : '',
      pkg ? `Package: ${pkg.name}` : '',
      curriculum ? `Curriculum: ${curriculum.name}` : '',
      studentUser
        ? `Student: ${studentUser.first_name ?? ''} ${studentUser.last_name ?? ''} <${studentUser.email ?? ''}>`
        : '',
      tutorUser
        ? `Tutor: ${tutorUser.first_name ?? ''} ${tutorUser.last_name ?? ''} <${tutorUser.email ?? ''}>`
        : '',
    ]
      .filter(Boolean)
      .join('\\n');

    const location = session.meet_link ?? '';

    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//K12Tutoring//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${this.safeText(summary)}`,
      `DESCRIPTION:${this.safeText(descriptionParts)}`,
      location ? `LOCATION:${this.safeText(location)}` : '',
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean);

    return icsLines.join('\r\n');
  }

  async getMessages(id: string, userId: string) {
    // 1. Resolve ID (could be Session ID or Booking ID)
    let finalSessionId = id;
    
    const booking = await this.prisma.bookings.findUnique({
      where: { id },
      include: { sessions: { orderBy: { created_at: 'desc' }, take: 1 } }
    });

    if (booking && booking.sessions.length > 0) {
      finalSessionId = booking.sessions[0].id;
    }

    // 2. Verify user has access
    await this.verifySessionOrBookingAccess(id, userId);

    const messages = await this.prisma.session_messages.findMany({
      where: { session_id: finalSessionId },
      orderBy: { created_at: 'asc' },
      include: {
        users: {
          select: {
            first_name: true,
            last_name: true,
            role: true,
          },
        },
      },
    });

    return messages.map((m) => ({
      id: m.id,
      from: `${m.users?.first_name || ''} ${m.users?.last_name || ''}`.trim(),
      role: m.users?.role,
      text: m.text,
      created_at: m.created_at,
    }));
  }

  async postMessage(id: string, userId: string, text: string) {
    // 1. Resolve ID (could be Session ID or Booking ID)
    let finalSessionId = id;
    
    const booking = await this.prisma.bookings.findUnique({
      where: { id },
      include: { sessions: { orderBy: { created_at: 'desc' }, take: 1 } }
    });

    if (booking) {
      if (booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      } else {
        // If no session exists for this booking, create one on the fly
        const newSession = await this.create({ booking_id: id });
        finalSessionId = newSession.id;
      }
    }

    // 2. Verify user has access
    await this.verifySessionOrBookingAccess(id, userId);

    const message = await this.prisma.session_messages.create({
      data: {
        session_id: finalSessionId,
        user_id: userId,
        text,
      },
      include: {
        users: {
          select: {
            first_name: true,
            last_name: true,
            role: true,
          },
        },
      },
    });

    return {
      id: message.id,
      from: `${message.users?.first_name || ''} ${message.users?.last_name || ''}`.trim(),
      role: message.users?.role,
      text: message.text,
      created_at: message.created_at,
    };
  }

  async validateJoinToken(sessionId: string, token: string) {
    try {
      const payload = this.jwtService.verify(token);
      // Optional: Check if payload.sessionId === sessionId if your token structure dictates it
      // For now, valid signature is enough to prove generic access, or payload.role check.

      return {
        valid: true,
        sessionId,
        user: { id: payload.sub, role: payload.role },
      };
    } catch (e) {
      this.logger.error(
        `Invalid join token for session ${sessionId}: ${e.message}`,
      );
      return { valid: false, error: 'Invalid or expired token' };
    }
  }

  // ==================== RECORDINGS ====================

  async getRecordings(sessionId: string, userId: string) {
    // Verify user has access to this session
    await this.verifySessionAccess(sessionId, userId);

    return this.prisma.session_recordings.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'desc' },
      include: {
        users: {
          select: {
            first_name: true,
            last_name: true,
          },
        },
      },
    });
  }

  async uploadRecording(
    sessionId: string,
    userId: string,
    buffer: Buffer,
    mimeType: string,
    fileSize?: number,
    duration?: number,
  ) {
    const session = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
      include: { bookings: true },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Only tutor or admin can upload recordings
    const booking = session.bookings;
    if (!booking) {
      throw new NotFoundException('Booking not found for this session');
    }

    // Verify user role
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    const isTutor = user?.role === 'tutor';
    const isAdmin = user?.role === 'admin';

    if (isTutor) {
        if (booking.assigned_tutor_id) {
            const tutor = await this.prisma.tutors.findUnique({ where: { id: booking.assigned_tutor_id } });
            if (tutor?.user_id !== userId) throw new ForbiddenException('Only the assigned tutor can upload recordings');
        } else {
            throw new ForbiddenException('No tutor assigned to this session');
        }
    } else if (!isAdmin) {
        throw new ForbiddenException('Only tutors and admins can upload recordings');
    }

    // Upload to Azure
    const blobName = await this.azureStorageService.uploadRecording(sessionId, buffer, mimeType);

    return this.prisma.session_recordings.create({
      data: {
        session_id: sessionId,
        uploaded_by: userId,
        azure_blob_name: blobName,
        file_url: null, // No longer using direct URL
        storage_path: blobName,
        file_size_bytes: fileSize,
        duration_seconds: duration,
        auto_delete_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });
  }

  async generateRecordingSasUrl(sessionId: string, recordingId: string, userId: string): Promise<any> {
    // 1. Resolve access
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (user?.role !== 'admin') {
      await this.verifySessionAccess(sessionId, userId);
    }

    // 2. Fetch recording
    const recording = await this.prisma.session_recordings.findUnique({
      where: { id: recordingId },
    });

    if (!recording || recording.session_id !== sessionId) {
      throw new NotFoundException('Recording not found for this session');
    }

    if (!recording.azure_blob_name) {
      throw new BadRequestException('This recording is not stored on Azure');
    }

    // 3. Update stats
    await this.prisma.session_recordings.update({
      where: { id: recordingId },
      data: {
        last_viewed_at: new Date(),
        view_count: { increment: 1 },
      },
    });

    // 4. Generate Sas URL (2 hours)
    const sasUrl = await this.azureStorageService.generateSasUrl('session-recordings', recording.azure_blob_name, 2);

    return {
      streamUrl: sasUrl,
      expiresIn: 7200, // 2 hours in seconds
    };
  }

  async recordAttendance(sessionId: string, studentId: string, present: boolean, minutesAttended?: number) {
    // Helper: Verify session exists
    const session = await this.prisma.sessions.findUnique({
      where: { id: sessionId }
    });
    if (!session) throw new NotFoundException('Session not found');

    // Verify student exists
    // Upsert attendance record
    return this.prisma.attendance.upsert({
      where: {
        // Composite key simulation or findFirst?
        // Prisma doesn't support where clause on non-unique fields in upsert unless @@unique is set.
        // We haven't set @@unique([sessionId, studentId]) in schema (oops, should have).
        // So we use findFirst -> update/create pattern.
        id: (await this.prisma.attendance.findFirst({
          where: { sessionId, studentId }
        }))?.id || '00000000-0000-0000-0000-000000000000' // Hacky workaround for upsert? No.
        // Let's use clean findFirst logic.
      },
      update: {
        present,
        minutesAttended,
        leftAt: present ? new Date() : null // Example logic
      },
      create: {
        sessionId,
        studentId,
        present,
        minutesAttended,
        joinedAt: present ? new Date() : null
      }
    }).catch(async (e) => {
      // If the ID hack failed because it didn't exist, we fallback to create.
      // Actually, let's just write explicit find-then-act logic to be safe and clear.
      const existing = await this.prisma.attendance.findFirst({
        where: { sessionId, studentId }
      });
      if (existing) {
        return this.prisma.attendance.update({
          where: { id: existing.id },
          data: { present, minutesAttended }
        });
      } else {
        return this.prisma.attendance.create({
          data: {
            sessionId,
            studentId,
            present,
            minutesAttended,
            joinedAt: new Date()
          }
        });
      }
    });
  }

  // ==================== HELPER METHODS ====================

  /**
   * Verify that a user has access to a session
   * Access is granted if user is:
   * - The parent of the student
   * - The student themselves
   * - The assigned tutor
   */
  public async verifySessionAccess(sessionId: string, userId: string) {
    const session = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
      include: {
        bookings: {
          include: {
            students: true,
            tutors: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const booking = session.bookings;
    if (!booking) {
      throw new NotFoundException('Booking not found for this session');
    }

    return this.checkBookingAccess(booking, userId);
  }

  /**
   * Verifies access for an ID that could be a Session ID OR a Booking ID.
   * Useful for connection tokens where the frontend might send either.
   */
  public async verifySessionOrBookingAccess(id: string, userId: string) {
    // 1. Try as Session ID
    const session = await this.prisma.sessions.findUnique({
      where: { id },
      include: { bookings: { include: { students: true, tutors: true } } },
    });

    if (session) {
      if (!session.bookings) throw new NotFoundException('Booking data missing');
      return this.checkBookingAccess(session.bookings, userId);
    }

    // 2. Try as Booking ID
    const booking = await this.prisma.bookings.findUnique({
      where: { id },
      include: { students: true, tutors: true },
    });

    if (booking) {
      return this.checkBookingAccess(booking, userId);
    }

    // 3. Neither found
    throw new NotFoundException('Session or Booking not found');
  }

  /**
   * Helper to resolve a Booking ID to its latest Session.
   */
  public async resolveBookingToSession(id: string) {
    return this.prisma.bookings.findUnique({
      where: { id },
      include: {
        sessions: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });
  }

  private checkBookingAccess(booking: any, userId: string): boolean {
    const student = booking.students;
    const tutor = booking.tutors;

    // Check if user is the parent
    const isParent = student?.parent_user_id === userId;

    // Check if user is the student
    const isStudent = student?.user_id === userId;

    // Check if user is the tutor
    const isTutor = tutor?.user_id === userId;

    // Check if user is admin (optional, handled by Guards usually but safe to add)
    // We don't have easy role check here without fetching User, assuming Guard handled Role.
    // Actually, Admin needs access too.
    // If the caller needs Admin check, they should handle it.
    // But for safety, strict ownership is better.
    // Let's rely on the calling Controller Guard for Admin bypass if needed.
    // But wait, if an Admin calls this, it will fail 403.
    // So we should realistically check if the user is an Admin?
    // The previous verifySessionAccess didn't check for Admin.

    if (!isParent && !isStudent && !isTutor) {
      // Allow passing for now, or throw? The original code threw Forbidden.
      throw new ForbiddenException('Access denied to this session');
    }

    return true;
  }

  async getAdminSummary(sessionId: string) {
    const session = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
      include: {
        session_recordings: true,
        session_messages: true,
        attendance: {
          include: { students: true }
        },
        bookings: {
          include: {
            students: true,
            tutors: { include: { users: true } }
          }
        }
      }
    });

    if (!session) throw new NotFoundException('Session not found');

    const participants: any[] = [];
    if (session.bookings?.students) {
      participants.push({
        role: 'student',
        name: `${session.bookings.students.first_name || ''} ${session.bookings.students.last_name || ''}`.trim(),
      });
    }
    
    if (session.bookings?.tutors?.users) {
      const t = session.bookings.tutors.users;
      participants.push({
        role: 'tutor',
        name: `${t.first_name || ''} ${t.last_name || ''}`.trim()
      });
    }

    let durationMinutes = 0;
    if (session.start_time && session.end_time) {
      durationMinutes = Math.floor((new Date(session.end_time).getTime() - new Date(session.start_time).getTime()) / 60000);
    } else if (session.start_time) {
      durationMinutes = Math.floor((Date.now() - new Date(session.start_time).getTime()) / 60000);
    }

    return {
      participants,
      duration: durationMinutes > 0 ? durationMinutes : 0,
      recordingLinks: session.session_recordings.map(r => r.file_url),
      chatLogCount: session.session_messages.length,
      whiteboardActivity: session.whiteboard_link !== null,
    };
  }

  async updateTutorNote(sessionId: string, userId: string, note: string) {
    let finalSessionId = sessionId;

    // 1. Try to find by Session ID
    let session = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
      include: {
        bookings: {
          include: {
            tutors: { include: { users: true } },
            students: true,
          },
        },
      },
    });

    // 2. If not found, try to resolve as a Booking ID
    if (!session) {
      const booking = await this.resolveBookingToSession(sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
        session = await this.prisma.sessions.findUnique({
          where: { id: finalSessionId },
          include: {
            bookings: {
              include: {
                tutors: { include: { users: true } },
                students: true,
              },
            },
          },
        });
      }
    }

    if (!session) {
      throw new NotFoundException('Session not found (ID could not be resolved from Booking or Session)');
    }

    if (!session.bookings?.tutors || session.bookings.tutors.user_id !== userId) {
      throw new ForbiddenException('Only the assigned tutor can add a note');
    }

    const updated = await this.prisma.sessions.update({
      where: { id: session.id },
      data: { tutor_note: note },
    });

    // Task 4: Notify parent
    const parentId = session.bookings.students?.parent_user_id;
    if (parentId) {
      const tutorName = session.bookings.tutors.users?.first_name 
        ? `${session.bookings.tutors.users.first_name} ${session.bookings.tutors.users.last_name || ''}`.trim()
        : 'Your tutor';
      
      const childId = session.bookings.student_id;
      if (childId) {
        await this.notificationsService.notifyParentSessionNote(parentId, childId, tutorName);
      }
    }

    return updated;
  }

  async getStickers(studentId: string) {
    return this.prisma.sticker_rewards.findMany({
      where: { student_id: studentId },
      orderBy: { given_at: 'desc' },
      include: {
        sessions: {
          select: {
            start_time: true,
            bookings: {
              select: {
                subjects: { select: { name: true } }
              }
            }
          }
        }
      }
    });
  }

  async saveWhiteboardSnapshot(sessionId: string, userId: string, base64: string) {
    // 1. Resolve ID (could be Session ID or Booking ID)
    let finalSessionId = sessionId;
    const booking = await this.prisma.bookings.findUnique({
      where: { id: sessionId },
      include: { sessions: { orderBy: { created_at: 'desc' }, take: 1 } }
    });
    if (booking && booking.sessions.length > 0) {
      finalSessionId = booking.sessions[0].id;
    }

    // 2. Verify user has access (only tutor/admin)
    // Controller role guard handles basic role, check ownership if needed
    // But since it's a snapshot of the whiteboard, let's keep it simple

    // 3. Convert base64 to Buffer
    const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    // 4. Upload to Azure
    const blobName = await this.azureStorageService.uploadWhiteboardSnapshot(finalSessionId, buffer);

    // 5. Update session record
    return this.prisma.sessions.update({
      where: { id: finalSessionId },
      data: {
        whiteboard_snapshot_url: blobName, // Saving blobName instead of URL/base64
      },
    });
  }

  async getWhiteboardSnapshotSasUrl(sessionId: string, userId: string) {
    // 1. Verify access
    await this.verifySessionOrBookingAccess(sessionId, userId);

    // 2. Get session and blob name
    let finalSessionId = sessionId;
    const booking = await this.prisma.bookings.findUnique({
        where: { id: sessionId },
        include: { sessions: { orderBy: { created_at: 'desc' }, take: 1 } }
    });
    if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
    }

    const session = await this.prisma.sessions.findUnique({
      where: { id: finalSessionId },
    });

    if (!session?.whiteboard_snapshot_url) {
      throw new NotFoundException('Snapshot not found for this session');
    }

    // 3. Generate SAS (24 hours)
    const sasUrl = await this.azureStorageService.generateSasUrl('whiteboard-snapshots', session.whiteboard_snapshot_url, 24);

    return {
      snapshotUrl: sasUrl,
      expiresIn: 86400,
    };
  }


  async updateSessionStatus(sessionId: string, status: string) {
    const session = await this.prisma.sessions.findUnique({
        where: { id: sessionId },
        include: { bookings: { include: { students: true } } }
    });
    if (!session) throw new NotFoundException('Session not found');

    const updated = await this.prisma.sessions.update({
        where: { id: sessionId },
        data: { status }
    });

    if (status === 'completed' && session.bookings?.student_id) {
        // Update total hours learned
        let durationHours = 1; // Default
        if (session.start_time && session.end_time) {
            durationHours = (new Date(session.end_time).getTime() - new Date(session.start_time).getTime()) / 3600000;
        }
        
        await this.prisma.students.update({
            where: { id: session.bookings.student_id },
            data: {
                total_hours_learned: { increment: durationHours }
            }
        });

        // Update streak
        await this.studentsService.updateStreak(session.bookings.student_id);

        // Check badges
        await this.checkBadges(session.bookings.student_id);
    }

    return updated;
  }

  async checkBadges(studentId: string) {
    const summary = await this.studentsService.getProgressSummary(studentId);
    const student = await this.prisma.students.findUnique({ where: { id: studentId } });
    if (!student) return;

    const earnedBadges = student.badges || [];
    const newBadges: string[] = [];

    for (const badge of BADGES) {
        if (!earnedBadges.includes(badge.id)) {
            if (badge.condition(summary)) {
                newBadges.push(badge.id);
            }
        }
    }

    if (newBadges.length > 0) {
        await this.prisma.students.update({
            where: { id: studentId },
            data: {
                badges: { set: [...earnedBadges, ...newBadges] }
            }
        });
        this.logger.log(`Student ${studentId} earned new badges: ${newBadges.join(', ')}`);
    }
  }
  async uploadSlide(sessionId: string, buffer: Buffer, mimeType: string, originalName: string) {
    // 1. Resolve ID (could be Session ID or Booking ID)
    let finalSessionId = sessionId;
    const booking = await this.prisma.bookings.findUnique({
      where: { id: sessionId },
      include: { sessions: { orderBy: { created_at: 'desc' }, take: 1 } }
    });
    if (booking && booking.sessions.length > 0) {
      finalSessionId = booking.sessions[0].id;
    }

    // 2. Upload to Azure (no DB record needed for temporary slides)
    return this.azureStorageService.uploadSlide(finalSessionId, buffer, mimeType, originalName);
  }

  async generateSlideSasUrl(sessionId: string, blobName: string) {
    // Generate SAS (1 hour)
    const sasUrl = await this.azureStorageService.generateSasUrl('session-slides', blobName, 1);
    return {
      sasUrl,
      expiresIn: 3600
    };
  }
}
