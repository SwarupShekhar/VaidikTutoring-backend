// src/sessions/sessions.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { EmailService } from 'src/email/email.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class SessionsService {
    private logger = new Logger(SessionsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly emailService: EmailService,
        private readonly jwtService: JwtService
    ) { }

    async create(dto: any) {
        if (!dto?.booking_id) throw new BadRequestException('booking_id is required');

        const booking = await this.prisma.bookings.findUnique({ where: { id: dto.booking_id } });
        if (!booking) throw new NotFoundException('Booking not found');

        const created = await this.prisma.sessions.create({
            data: {
                booking_id: dto.booking_id,
                start_time: dto.start_time ? new Date(dto.start_time) : booking.requested_start ?? new Date(),
                end_time: dto.end_time ? new Date(dto.end_time) : booking.requested_end ?? new Date(Date.now() + 60 * 60 * 1000),
                meet_link: dto.meet_link ?? `https://meet.jit.si/k12-${booking.id}`,
                whiteboard_link: dto.whiteboard_link ?? null,
                status: dto.status ?? 'scheduled',
            },
        });

        // generate ICS
        const ics = await this.generateIcsInvite(created.id);

        // collect recipient emails (student, parent, tutor)
        const recipients = new Set<string>();

        if (booking.student_id) {
            const student = await this.prisma.students.findUnique({ where: { id: booking.student_id } });
            if (student) {
                if (student.parent_user_id) {
                    const parent = await this.prisma.users.findUnique({ where: { id: student.parent_user_id } });
                    if (parent?.email) recipients.add(parent.email);
                }
                if (student.user_id) {
                    const studentUser = await this.prisma.users.findUnique({ where: { id: student.user_id } });
                    if (studentUser?.email) recipients.add(studentUser.email);
                }
            }
        }

        if (booking.assigned_tutor_id) {
            const tutor = await this.prisma.tutors.findUnique({ where: { id: booking.assigned_tutor_id } });
            if (tutor) {
                const tutorUser = await this.prisma.users.findUnique({ where: { id: tutor.user_id } });
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
                this.logger.error('Failed to send session invite email', err as any);
                // non-fatal: session already created
            }
        } else {
            this.logger.warn('No recipient emails found for session. Invite not emailed.');
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
            const students = await this.prisma.students.findMany({ where: { parent_user_id: userId } });
            const studentIds = students.map(s => s.id);
            const bookings = await this.prisma.bookings.findMany({ where: { student_id: { in: studentIds } } });
            bookingIds = bookings.map(b => b.id);
        } else if (user.role === 'student') {
            const student = await this.prisma.students.findFirst({ where: { user_id: userId } });
            if (student) {
                const bookings = await this.prisma.bookings.findMany({ where: { student_id: student.id } });
                bookingIds = bookings.map(b => b.id);
            }
        } else if (user.role === 'tutor') {
            const tutor = await this.prisma.tutors.findFirst({ where: { user_id: userId } });
            if (tutor) {
                const bookings = await this.prisma.bookings.findMany({ where: { assigned_tutor_id: tutor.id } });
                bookingIds = bookings.map(b => b.id);
            }
        }

        // Fetch sessions for these bookings
        return this.prisma.sessions.findMany({
            where: { booking_id: { in: bookingIds } },
            orderBy: { start_time: 'asc' },
            include: {
                bookings: {
                    include: {
                        subjects: true,
                        students: true,
                        tutors: { include: { users: true } }
                    }
                }
            }
        });
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
        const session = await this.prisma.sessions.findUnique({ where: { id: sessionId } });
        if (!session) throw new NotFoundException('Session not found');

        const booking = session.booking_id ? await this.prisma.bookings.findUnique({ where: { id: session.booking_id } }) : null;

        let studentUser: any = null;
        if (booking?.student_id) {
            const student = await this.prisma.students.findUnique({ where: { id: booking.student_id } });
            if (student) {
                if (student.user_id) { // Existing check for student.user_id
                    studentUser = await this.prisma.users.findUnique({ where: { id: student.user_id } });
                }
            }
        }

        let tutorUser: any = null;
        if (booking?.assigned_tutor_id) {
            const tutor = await this.prisma.tutors.findUnique({ where: { id: booking.assigned_tutor_id } });
            if (tutor) tutorUser = await this.prisma.users.findUnique({ where: { id: tutor.user_id } });
        }

        const subject = booking?.subject_id ? await this.prisma.subjects.findUnique({ where: { id: booking.subject_id } }) : null;
        const pkg = booking?.package_id ? await this.prisma.packages.findUnique({ where: { id: booking.package_id } }) : null;
        const curriculum = booking?.curriculum_id ? await this.prisma.curricula.findUnique({ where: { id: booking.curriculum_id } }) : null;

        const startDt = session.start_time ? new Date(session.start_time) : booking?.requested_start ? new Date(booking.requested_start) : new Date();
        const endDt = session.end_time ? new Date(session.end_time) : booking?.requested_end ? new Date(booking.requested_end) : new Date(Date.now() + 60 * 60 * 1000);

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
            studentUser ? `Student: ${studentUser.first_name ?? ''} ${studentUser.last_name ?? ''} <${studentUser.email ?? ''}>` : '',
            tutorUser ? `Tutor: ${tutorUser.first_name ?? ''} ${tutorUser.last_name ?? ''} <${tutorUser.email ?? ''}>` : '',
        ].filter(Boolean).join('\\n');

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


    async getMessages(sessionId: string) {
        return this.prisma.session_messages.findMany({
            where: { session_id: sessionId },
            orderBy: { created_at: 'asc' },
            include: {
                users: {
                    select: {
                        first_name: true,
                        last_name: true,
                        role: true
                    }
                }
            }
        });
    }

    async postMessage(sessionId: string, userId: string, text: string) {
        const session = await this.prisma.sessions.findUnique({ where: { id: sessionId } });
        if (!session) throw new NotFoundException('Session not found');

        return this.prisma.session_messages.create({
            data: {
                session_id: sessionId,
                user_id: userId,
                text
            }
        });
    }

    async validateJoinToken(sessionId: string, token: string) {
        try {
            const payload = this.jwtService.verify(token);
            // Optional: Check if payload.sessionId === sessionId if your token structure dictates it
            // For now, valid signature is enough to prove generic access, or payload.role check.

            return {
                valid: true,
                sessionId,
                user: { id: payload.sub, role: payload.role }
            };
        } catch (e) {
            this.logger.error(`Invalid join token for session ${sessionId}: ${e.message}`);
            return { valid: false, error: 'Invalid or expired token' };
        }
    }
}