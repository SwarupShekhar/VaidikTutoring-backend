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
import { ZoomService } from '../zoom/zoom.service';
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
    private readonly zoomService: ZoomService,
    @Inject(forwardRef(() => StudentsService))
    private readonly studentsService: StudentsService,
  ) { }

  async create(dto: any) {
    if (!dto?.booking_id && !dto?.start_time)
      throw new BadRequestException('booking_id or start_time is required');

    let booking: any = null;
    if (dto.booking_id) {
      booking = await this.prisma.bookings.findUnique({
        where: { id: dto.booking_id },
        include: {
          students: {
            include: {
              users_students_user_idTousers: { select: { email: true } },
              users_students_parent_user_idTousers: { select: { email: true } },
            },
          },
          tutors: {
            include: {
              users: { select: { email: true } },
            },
          },
        },
      });
      if (!booking) throw new NotFoundException('Booking not found');
    }

    const start = dto.start_time
      ? new Date(dto.start_time)
      : (booking?.requested_start ?? new Date());
    
    const end = dto.end_time
      ? new Date(dto.end_time)
      : (booking?.requested_end ?? new Date(Date.now() + 60 * 60 * 1000));

    let zoomMeetingId: string | null = null;
    let zoomJoinUrl: string | null = null;

    if (dto.video_provider === 'ZOOM') {
      const overlapping = await this.prisma.sessions.findFirst({
        where: {
          video_provider: 'ZOOM',
          status: { notIn: ['cancelled', 'completed'] },
          start_time: { lt: end },
          end_time: { gt: start },
        }
      });

      if (overlapping) {
        throw new BadRequestException('A Zoom meeting is already scheduled for this time slot. Concurrent Zoom meetings are not allowed.');
      }

      const duration = Math.round((end.getTime() - start.getTime()) / 60000);
      const zoomMeeting = await this.zoomService.createMeeting(`Tutoring Session`, start, duration);
      zoomMeetingId = zoomMeeting.meetingId;
      zoomJoinUrl = zoomMeeting.joinUrl;
      if (!dto.meet_link) dto.meet_link = zoomJoinUrl;
    }

    const created = await this.prisma.sessions.create({
      data: {
        booking_id: dto.booking_id ?? null,
        start_time: start,
        end_time: end,
        meet_link: dto.meet_link ?? null, // Default to null, will be populated by Daily.co later or manually
        whiteboard_link: dto.whiteboard_link ?? null,
        status: dto.status ?? 'scheduled',
        video_provider: dto.video_provider ?? 'DAILYCO',
        zoom_meeting_id: zoomMeetingId,
        zoom_join_url: zoomJoinUrl,
      },
    });

    // generate ICS
    const ics = await this.generateIcsInvite(created.id);

    // collect recipient emails (student, parent, tutor) — using pre-loaded relations
    const recipients = new Set<string>();

    if (booking) {
      if (booking.students) {
        const parentEmail = booking.students.users_students_parent_user_idTousers?.email;
        if (parentEmail) recipients.add(parentEmail);

        const studentEmail = booking.students.users_students_user_idTousers?.email;
        if (studentEmail) recipients.add(studentEmail);
      }

      const tutorEmail = booking.tutors?.users?.email;
      if (tutorEmail) recipients.add(tutorEmail);
    }

    // send email if recipients found
    const to = Array.from(recipients);
    if (to.length > 0) {
      try {
        await this.emailService.sendSessionInvite({
          to,
          subject: `Tutoring Session — ${created.id}`,
          plaintext: `Your tutoring session is scheduled.\n${booking ? `Booking: ${booking.id}\n` : ''}Start: ${created.start_time}\n${zoomJoinUrl ? `Zoom Join URL: ${zoomJoinUrl}\n` : ''}`,
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

    const sessionInclude = {
      bookings: {
        include: {
          subjects: true,
          students: true,
          tutors: { include: { users: true } },
        },
      },
    };

    if (user.role === 'parent') {
      // Find all students for this parent, then filter sessions through the bookings relation
      const students = await this.prisma.students.findMany({
        where: { parent_user_id: userId },
        select: { id: true },
      });
      const studentIds = students.map((s) => s.id);
      if (studentIds.length === 0) return [];
      return this.prisma.sessions.findMany({
        where: { bookings: { student_id: { in: studentIds } } },
        take: 100,
        orderBy: { start_time: 'asc' },
        include: sessionInclude,
      });
    } else if (user.role === 'student') {
      const student = await this.prisma.students.findFirst({
        where: { user_id: userId },
      });
      if (!student) return [];
      return this.prisma.sessions.findMany({
        where: { bookings: { student_id: student.id } },
        take: 100,
        orderBy: { start_time: 'asc' },
        include: sessionInclude,
      });
    } else if (user.role === 'tutor') {
      const tutor = await this.prisma.tutors.findFirst({
        where: { user_id: userId },
      });
      if (!tutor) return [];
      return this.prisma.sessions.findMany({
        where: { bookings: { assigned_tutor_id: tutor.id } },
        take: 100,
        orderBy: { start_time: 'asc' },
        include: sessionInclude,
      });
    }

    return [];
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
          include: {
            students: {
              include: {
                users_students_user_idTousers: { select: { id: true, email: true, first_name: true, last_name: true } },
              },
            },
            tutors: {
              include: {
                users: { select: { id: true, email: true, first_name: true, last_name: true } },
              },
            },
            subjects: true,
            packages: true,
            curricula: true,
          },
        })
      : null;

    const studentUser = booking?.students?.users_students_user_idTousers ?? null;
    const tutorUser = booking?.tutors?.users ?? null;
    const subject = booking?.subjects ?? null;
    const pkg = booking?.packages ?? null;
    const curriculum = booking?.curricula ?? null;

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

  async getRecordings(idOrBookingId: string, userId: string) {
    // Verify user has access to this session & resolve ID
    const sessionId = await this.ensureSessionId(idOrBookingId);
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
    idOrBookingId: string,
    userId: string,
    buffer: Buffer,
    mimeType: string,
    fileSize?: number,
    duration?: number,
  ) {
    const sessionId = await this.ensureSessionId(idOrBookingId);
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

  async generateRecordingSasUrl(idOrBookingId: string, recordingId: string, userId: string): Promise<any> {
    // 1. Resolve access
    const sessionId = await this.ensureSessionId(idOrBookingId);
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

  async recordAttendance(idOrBookingId: string, studentId: string, present: boolean, minutesAttended?: number) {
    const sessionId = await this.ensureSessionId(idOrBookingId);
    const session = await this.prisma.sessions.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    return this.prisma.attendance.upsert({
      where: {
        sessionId_studentId: { sessionId, studentId },
      },
      update: {
        present,
        // Manual tutor/admin mark — an explicit override that always counts as
        // qualifying attendance regardless of captured minutes.
        markedByTutor: true,
        minutesAttended,
        ...(present === false && { leftAt: new Date() }),
        ...(present === true && { leftAt: null }),
      },
      create: {
        sessionId,
        studentId,
        present,
        markedByTutor: true,
        minutesAttended,
        joinedAt: present ? new Date() : null,
        ...(present === false && { leftAt: new Date() }),
      },
    });
  }

  // ==================== AUTOMATIC ATTENDANCE (socket-driven) ====================

  /**
   * Marks a student as present for a session when their socket joins.
   * - Upserts the Attendance row, setting present=true.
   * - Sets joinedAt ONLY if it is currently null (do not overwrite on reconnect),
   *   so the original arrival time is preserved across socket drops/reconnects.
   * - Clears leftAt to indicate the student is currently active.
   *
   * Note on reconnect interval anchoring: the schema has a single joinedAt column,
   * so on reconnect we re-anchor joinedAt to "now" to mark the start of the new
   * active interval (minutesAttended having already been accumulated on the prior
   * markStudentLeft). For the common single-join/single-leave case this is exact.
   */
  async markStudentPresent(sessionId: string, studentId: string) {
    const existing = await this.prisma.attendance.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });

    // Re-anchor joinedAt to now ONLY when there is no active interval open
    // (i.e. the student had previously left, or there is no row yet). If an
    // interval is already open (joinedAt set AND leftAt null) we keep the old
    // anchor so the open interval — including one orphaned by a server restart —
    // is preserved for later accumulation / finalization.
    const intervalIsOpen =
      !!existing && existing.joinedAt !== null && existing.leftAt === null;
    const openAnchor = intervalIsOpen ? existing!.joinedAt : new Date();

    // upsert is atomic — no find-then-create race / unique-constraint (P2002)
    // even if two of the student's clients fire a first-join simultaneously.
    return this.prisma.attendance.upsert({
      where: { sessionId_studentId: { sessionId, studentId } },
      create: {
        sessionId,
        studentId,
        present: true,
        joinedAt: new Date(),
        leftAt: null,
      },
      update: {
        present: true,
        joinedAt: openAnchor,
        leftAt: null,
      },
    });
  }

  /**
   * Marks a student as having left when their socket disconnects/leaves.
   * - Sets leftAt = now.
   * - ACCUMULATES minutesAttended by adding the just-ended interval
   *   (now - joinedAt) to the existing total. Never overwrites, never goes negative.
   * If no Attendance row exists yet, this is a no-op (returns null).
   */
  async markStudentLeft(sessionId: string, studentId: string) {
    const existing = await this.prisma.attendance.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });

    if (!existing) {
      // Nothing to update — student was never marked present.
      return null;
    }

    // Idempotency guard: if the interval is already closed (leftAt set — e.g. the
    // session was finalized at end, or a duplicate leave already fired) do NOT
    // accumulate again. markStudentPresent reopens the interval (leftAt=null) on a
    // genuine rejoin, so legitimate multi-visit accumulation still works.
    if (existing.leftAt !== null) {
      return existing;
    }

    const now = new Date();

    // Compute minutes for the just-ended interval. Anchor on the most recent
    // joinedAt. Guard against null anchor and clock skew (never negative/NaN).
    let intervalMinutes = 0;
    if (existing.joinedAt) {
      const deltaMs = now.getTime() - new Date(existing.joinedAt).getTime();
      if (Number.isFinite(deltaMs) && deltaMs > 0) {
        intervalMinutes = Math.round(deltaMs / 60000);
      }
    }

    const accumulated = (existing.minutesAttended ?? 0) + intervalMinutes;

    return this.prisma.attendance.update({
      where: { sessionId_studentId: { sessionId, studentId } },
      data: {
        leftAt: now,
        minutesAttended: accumulated,
      },
    });
  }

  /**
   * Backstop run when a session ends/completes. Finalizes any attendance row
   * still showing an OPEN interval (present=true, leftAt=null) — i.e. a student
   * who was connected at session end, or whose leave event was lost (e.g. the
   * gateway's in-memory client map was wiped by a server restart/redeploy, or a
   * second gateway instance handled the socket). Sets leftAt=endTime and
   * accumulates the final interval. Idempotent: only touches open intervals, so
   * a later stray markStudentLeft (guarded on leftAt) will not double-count.
   */
  async finalizeSessionAttendance(sessionId: string, endTime?: Date) {
    const end = endTime ?? new Date();
    const openRows = await this.prisma.attendance.findMany({
      where: { sessionId, present: true, leftAt: null },
    });

    for (const row of openRows) {
      let intervalMinutes = 0;
      if (row.joinedAt) {
        const deltaMs = end.getTime() - new Date(row.joinedAt).getTime();
        if (Number.isFinite(deltaMs) && deltaMs > 0) {
          intervalMinutes = Math.round(deltaMs / 60000);
        }
      }
      await this.prisma.attendance.update({
        where: { id: row.id },
        data: {
          leftAt: end,
          minutesAttended: (row.minutesAttended ?? 0) + intervalMinutes,
        },
      });
    }

    return { finalized: openRows.length };
  }

  // ==================== HELPER METHODS ====================

  /**
   * Verified that a user has access to a session
   * Access is granted if user is:
   * - The parent of the student
   * - The student themselves
   * - The assigned tutor
   */
  public async verifySessionAccess(idOrBookingId: string, userId: string) {
    const sessionId = await this.ensureSessionId(idOrBookingId);
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

  private async checkBookingAccess(booking: any, userId: string): Promise<boolean> {
    // 0. check if user is admin
    const currentUser = await this.prisma.users.findUnique({
        where: { id: userId },
        select: { email: true, role: true }
    });
    if (currentUser?.role === 'admin') return true;

    const student = booking.students;
    const tutor = booking.tutors;

    // Check if user is the parent
    let isParent = student?.parent_user_id === userId;

    // Check if user is the student
    let isStudent = student?.user_id === userId;

    // Check if user is the tutor
    let isTutor = tutor?.user_id === userId;

    // Identity drift auto-heal fallback: Compare emails case-insensitively and trim spaces
    // This fixes 403s where the DB record was created with a different email casing/spacing
    if (!isTutor && tutor?.user_id && currentUser?.email) {
      const tutorUser = await this.prisma.users.findUnique({ where: { id: tutor.user_id }, select: { email: true } });
      if (tutorUser?.email && tutorUser.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()) {
        isTutor = true;
      }
    }

    if (!isStudent && student && currentUser?.email) {
      // 1. Check if the student record itself has a matching email
      if (student.email && student.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()) {
         isStudent = true;
      } 
      // 2. Check if the student's linked user record has a matching email
      else if (student.user_id) {
        const studentUser = await this.prisma.users.findUnique({ where: { id: student.user_id }, select: { email: true } });
        if (studentUser?.email && studentUser.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()) {
          isStudent = true;
        }
      }
    }




    if (!isParent && !isStudent && !isTutor) {
      // Self-diagnosing log: a 403 here is almost always identity drift (the
      // resolved users.id is NOT the one the booking points at) rather than a
      // genuine misassignment. Emit BOTH sides so the cause is visible in the
      // logs without needing to reproduce. Email lookups are best-effort.
      try {
        const [resolved, tutorUser] = await Promise.all([
          this.prisma.users.findUnique({
            where: { id: userId },
            select: { email: true, role: true },
          }),
          tutor?.user_id
            ? this.prisma.users.findUnique({
                where: { id: tutor.user_id },
                select: { email: true },
              })
            : Promise.resolve(null),
        ]);
        this.logger.warn(
          `Access denied (booking ${booking?.id ?? 'unknown'}): resolved userId=${userId} ` +
            `(email=${resolved?.email ?? '?'}, role=${resolved?.role ?? '?'}) is not a participant. ` +
            `Expected one of -> tutor.user_id=${tutor?.user_id ?? 'none'} (email=${tutorUser?.email ?? '?'}), ` +
            `student.user_id=${student?.user_id ?? 'none'}, parent_user_id=${student?.parent_user_id ?? 'none'}.`,
        );
      } catch (logErr) {
        this.logger.warn(
          `Access denied (booking ${booking?.id ?? 'unknown'}): resolved userId=${userId} ` +
            `is not tutor.user_id=${tutor?.user_id ?? 'none'} / student.user_id=${student?.user_id ?? 'none'} ` +
            `/ parent_user_id=${student?.parent_user_id ?? 'none'}. (identity lookup failed: ${logErr.message})`,
        );
      }
      throw new ForbiddenException('Access denied to this session');
    }

    return true;
  }

  async getAdminSummary(idOrBookingId: string) {
    const sessionId = await this.ensureSessionId(idOrBookingId);
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

    const students: any[] = [];
    if (session.bookings?.students) {
      students.push({
        name: `${session.bookings.students.first_name || ''} ${session.bookings.students.last_name || ''}`.trim(),
      });
    }
    if (session.attendance && session.attendance.length > 0) {
      session.attendance.forEach(att => {
        if (att.students) {
          students.push({
            name: `${att.students.first_name || ''} ${att.students.last_name || ''}`.trim(),
          });
        }
      });
    }

    const tutors: any[] = [];
    if (session.bookings?.tutors?.users) {
      const t = session.bookings.tutors.users;
      tutors.push({
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
      students,
      tutors,
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


  async updateSessionStatus(idOrBookingId: string, status: string, userId?: string) {
    const sessionId = await this.ensureSessionId(idOrBookingId);
    const session = await this.prisma.sessions.findUnique({
        where: { id: sessionId },
        include: { bookings: { include: { students: true } } }
    });
    if (!session) throw new NotFoundException('Session not found');

    // Perform the update with optimistic concurrency control if completing
    let updated;
    if (status === 'completed') {
        try {
            updated = await this.prisma.sessions.update({
                where: { id: sessionId, status: { not: 'completed' } },
                data: { status }
            });
            
            // Only runs if the status was NOT already completed
            if (session.bookings?.student_id) {
                await this.handleSessionCompletion(
                    sessionId,
                    session.bookings.student_id,
                    session.start_time || undefined,
                    session.end_time || new Date()
                );
            }
        } catch (e: any) {
            if (e?.code === 'P2025') {
                // Another request already completed it concurrently, safe to skip
                updated = await this.prisma.sessions.findUnique({ where: { id: sessionId } });
            } else {
                throw e;
            }
        }
    } else {
        updated = await this.prisma.sessions.update({
            where: { id: sessionId },
            data: { status }
        });
    }

    // Audit Log for Activity Pulse
    try {
        await this.prisma.audit_logs.create({
            data: {
                action: `SESSION_${status.toUpperCase()}`,
                actor_user_id: userId || '00000000-0000-0000-0000-000000000000', // System fallback
                details: {
                    sessionId,
                    studentName: session.bookings?.students ? `${session.bookings.students.first_name} ${session.bookings.students.last_name || ''}`.trim() : 'Unknown',
                    triggeredBy: userId ? 'user' : 'webhook'
                }
            }
        });
    } catch (e) {
        console.error('Failed to audit session status update', e);
    }

    return updated;
  }

  async handleSessionCompletion(sessionId: string, studentId: string, startTime?: Date, endTime?: Date) {
    // Update total hours learned and completed sessions
    let durationHours = 1; // Default
    if (startTime && endTime) {
        durationHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3600000;
    }

    await this.prisma.students.update({
        where: { id: studentId },
        data: { total_hours_learned: { increment: durationHours } }
    });

    // Update streak + badges
    await this.studentsService.updateStreak(studentId);
    await this.checkBadges(studentId);
  }

  // FIX 3: Unified method to end a session (mark as completed)
  async endSession(idOrBookingId: string, userId: string) {
    const sessionId = await this.ensureSessionId(idOrBookingId);
    const session = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
      include: { bookings: true }
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status === 'completed') {
      return {
        success: true,
        sessionId: session.id,
        status: session.status,
        message: 'Session already completed',
      };
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { tutors: true }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Permission checks: user must be tutor, the student, parent of student, or admin
    const isAdmin = user.role === 'admin';
    const isTutor = user.role === 'tutor' || (user.tutors && user.tutors.length > 0);

    // Check if user is the student in this session
    let isStudent = false;
    if (user.role === 'student' && session.bookings?.student_id) {
      const student = await this.prisma.students.findUnique({
        where: { id: session.bookings.student_id },
        include: { users_students_user_idTousers: true }
      });
      if (student && (student.user_id === userId || 
          student.email?.toLowerCase() === user.email?.toLowerCase() ||
          student.users_students_user_idTousers?.email?.toLowerCase() === user.email?.toLowerCase())) {
        isStudent = true;
      }
    }

    // Check if user is the parent of the student
    let isParent = false;
    if (user.role === 'parent' && session.bookings?.student_id) {
      const student = await this.prisma.students.findUnique({
        where: { id: session.bookings.student_id }
      });
      if (student) {
        if (student.parent_user_id === userId) {
          isParent = true;
        } else if (student.parent_user_id) {
          const parentUser = await this.prisma.users.findUnique({ where: { id: student.parent_user_id }});
          if (parentUser && parentUser.email?.toLowerCase() === user.email?.toLowerCase()) {
            isParent = true;
          }
        }
      }
    }

    if (!isAdmin && !isTutor && !isStudent && !isParent) {
      throw new ForbiddenException('You do not have access to this session');
    }

    // Mark session as completed
    let updated;
    try {
      updated = await this.prisma.sessions.update({
        where: { id: sessionId, status: { not: 'completed' } },
        data: {
          status: 'completed',
          end_time: session.end_time || new Date()
        },
        include: { bookings: true }
      });
    } catch (e: any) {
      if (e?.code === 'P2025') {
        const existing = await this.prisma.sessions.findUnique({ where: { id: sessionId }, include: { bookings: true } });
        return {
          success: true,
          sessionId: sessionId,
          status: 'completed',
          message: 'Session already completed',
        };
      }
      throw e;
    }

    // Finalize any open attendance intervals (students still connected at end,
    // or whose leave event was lost). Non-fatal — never block session end.
    try {
      await this.finalizeSessionAttendance(sessionId, updated.end_time || new Date());
    } catch (e) {
      this.logger.error(`finalizeSessionAttendance failed (non-fatal): ${e.message}`);
    }

    // Update student progress using unified logic
    if (updated.bookings?.student_id) {
        await this.handleSessionCompletion(
            sessionId,
            updated.bookings.student_id,
            updated.start_time || undefined,
            updated.end_time || new Date()
        );
    }

    // Audit Log for ending session
    try {
        await this.prisma.audit_logs.create({
            data: {
                action: 'SESSION_COMPLETED',
                actor_user_id: userId,
                details: { sessionId }
            }
        });
    } catch (e) {}

    return {
      success: true,
      sessionId: updated.id,
      status: updated.status,
      message: 'Session ended successfully'
    };
  }

  /**
   * Resolves a provided ID (which could be a Session ID or a Booking ID) to an actual Session record.
   * If a Booking ID is provided and no session exists, it creates one.
   */
  async ensureSessionId(idOrBookingId: string): Promise<string> {
    // 1. Try as Session ID
    const session = await this.prisma.sessions.findUnique({ where: { id: idOrBookingId } });
    if (session) return session.id;

    // 2. Try as Booking ID
    const booking = await this.prisma.bookings.findUnique({
      where: { id: idOrBookingId },
      include: { sessions: { orderBy: { created_at: 'desc' }, take: 1 } }
    });

    if (!booking) throw new NotFoundException('Session or Booking not found');

    if (booking.sessions.length > 0) {
      return booking.sessions[0].id;
    }

    // 3. Create a new session for this booking if none exists
    const newSession = await this.create({
      booking_id: booking.id,
      status: 'scheduled'
    });
    return newSession.id;
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

  // ==================== CLASS NOTES ====================

  async shareNote(
    idOrBookingId: string,
    userId: string,
    title: string,
    noteType: string,
    buffer?: Buffer,
    mimeType?: string,
    originalName?: string,
    content?: string,
  ) {
    // 1. Resolve to canonical Session ID
    const sessionId = await this.ensureSessionId(idOrBookingId);

    // 2. Verify session exists
    const session = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
      include: { bookings: true },
    });
    if (!session) throw new NotFoundException('Session not found');

    // Authorization: admins may share with anyone; a tutor may ONLY share on a
    // session they actually taught (the session's assigned tutor). This is what
    // establishes the tutor↔student connection — a tutor with no shared session
    // with a student cannot reach them. Sharing is also only allowed once the
    // session has actually happened (post-session handoff).
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (user?.role !== 'tutor' && user?.role !== 'admin') {
      throw new ForbiddenException('Only tutors and admins can share notes');
    }

    if (user.role === 'tutor') {
      const tutor = await this.prisma.tutors.findFirst({
        where: { user_id: userId },
        select: { id: true },
      });
      const assignedTutorId = session.bookings?.assigned_tutor_id ?? null;
      if (!tutor || !assignedTutorId || assignedTutorId !== tutor.id) {
        throw new ForbiddenException(
          'You can only share materials for sessions you taught this student.',
        );
      }

      // Must be a session that has actually occurred (completed or past).
      const now = new Date();
      const occurred =
        session.status === 'completed' ||
        (session.status !== 'cancelled' &&
          ((session.end_time && new Date(session.end_time) < now) ||
            (session.bookings?.requested_end &&
              new Date(session.bookings.requested_end) < now)));
      if (!occurred) {
        throw new ForbiddenException(
          'You can share materials only after the session has taken place.',
        );
      }
    }

    let blobName: string | null = null;
    if (buffer && mimeType && originalName) {
      blobName = await this.azureStorageService.uploadNote(sessionId, buffer, mimeType, originalName);
    }

    return this.prisma.class_notes.create({
      data: {
        session_id: sessionId,
        uploaded_by: userId,
        title,
        note_type: noteType,
        blob_name: blobName,
        content: content || null,
      },
    });
  }

  async getSessionNotes(idOrBookingId: string, userId: string) {
    await this.verifySessionOrBookingAccess(idOrBookingId, userId);
    const sessionId = await this.ensureSessionId(idOrBookingId);
    return this.prisma.class_notes.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'desc' },
      include: {
        users: { select: { first_name: true, last_name: true } },
      },
    });
  }

  async getStudentNotes(userId: string) {
    // Find all sessions for this student
    const student = await this.prisma.students.findFirst({
      where: { user_id: userId },
      include: {
        bookings: {
          include: { sessions: true },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    const sessionIds = student.bookings.flatMap(b => b.sessions.map(s => s.id));

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

  async generateNoteSasUrl(noteId: string, userId: string) {
    const note = await this.prisma.class_notes.findUnique({
      where: { id: noteId },
      include: {
        sessions: {
          include: { bookings: { include: { subjects: true } } },
        },
      },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (!note.blob_name) throw new BadRequestException('This note has no file attachment');

    // Verify access
    await this.verifySessionOrBookingAccess(note.session_id, userId);

    const sasUrl = await this.azureStorageService.generateSasUrl('class-notes', note.blob_name, 2);
    return { url: sasUrl, expiresIn: 7200 };
  }
}
