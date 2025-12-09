import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns'; // small util we will use; optional

@Injectable()
export class InviteService {
    constructor(private readonly prisma: PrismaService) { }

    private toIcsDate(dt: Date) {
        // Format to YYYYMMDDTHHMMSSZ (UTC)
        const yyyy = dt.getUTCFullYear().toString().padStart(4, '0');
        const mm = (dt.getUTCMonth() + 1).toString().padStart(2, '0');
        const dd = dt.getUTCDate().toString().padStart(2, '0');
        const hh = dt.getUTCHours().toString().padStart(2, '0');
        const min = dt.getUTCMinutes().toString().padStart(2, '0');
        const ss = dt.getUTCSeconds().toString().padStart(2, '0');
        return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
    }

    private safeText(t: any) {
        if (!t && t !== 0) return '';
        return String(t).replace(/\r\n/g, '\\n').replace(/\n/g, '\\n');
    }

    async generateIcsForBooking(bookingId: string, requestingUserId?: string) {
        // Load the booking + session + related rows
        const booking = await this.prisma.bookings.findUnique({ where: { id: bookingId } });
        if (!booking) throw new NotFoundException('Booking not found');

        // Optionally authorize: requester must be parent of the student or assigned tutor or admin
        if (requestingUserId) {
            // check parent
            const student = booking.student_id ? await this.prisma.students.findUnique({ where: { id: booking.student_id } }) : null;
            const tutorRow = booking.assigned_tutor_id ? await this.prisma.tutors.findUnique({ where: { id: booking.assigned_tutor_id } }) : null;
            const isParent = !!(student && student.parent_user_id === requestingUserId);
            const isAssignedTutor = !!(tutorRow && tutorRow.user_id === requestingUserId);
            if (!isParent && !isAssignedTutor) {
                // allow if admin? your system may have role-checking elsewhere
                throw new ForbiddenException('Not allowed to fetch invite for this booking');
            }
        }

        // find session (if any) linked to this booking
        const session = await this.prisma.sessions.findFirst({
            where: { booking_id: bookingId },
            orderBy: { created_at: 'desc' },
        });

        // fetch student user
        const student = booking.student_id ? await this.prisma.students.findUnique({ where: { id: booking.student_id } }) : null;
        const studentUser = (student && student.user_id) ? await this.prisma.users.findUnique({ where: { id: student.user_id } }) : null;

        // fetch tutor user
        let tutorUser: any = null;
        if (booking.assigned_tutor_id) {
            const tutorRow = await this.prisma.tutors.findUnique({ where: { id: booking.assigned_tutor_id } });
            if (tutorRow) tutorUser = await this.prisma.users.findUnique({ where: { id: tutorRow.user_id } });
        }

        // fetch subject/package/curriculum names (optional)
        const subject = booking.subject_id ? await this.prisma.subjects.findUnique({ where: { id: booking.subject_id } }) : null;
        const pkg = booking.package_id ? await this.prisma.packages.findUnique({ where: { id: booking.package_id } }) : null;
        const curriculum = booking.curriculum_id ? await this.prisma.curricula.findUnique({ where: { id: booking.curriculum_id } }) : null;

        // pick times: prefer session times; fallback to booking requested_start/end; fallback to now+1h
        const startIso = session?.start_time ?? booking.requested_start ?? new Date().toISOString();
        const endIso = session?.end_time ?? booking.requested_end ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();

        const startDt = new Date(startIso);
        const endDt = new Date(endIso);

        const dtstamp = this.toIcsDate(new Date());
        const uid = `booking-${booking.id}@k12tutoring.local`;
        const dtstart = this.toIcsDate(startDt);
        const dtend = this.toIcsDate(endDt);

        const summary = `${subject?.name ?? 'Tutoring Session'} — ${pkg?.name ?? ''}`.trim();
        const descriptionParts = [
            `Booking ID: ${booking.id}`,
            `Subject: ${subject?.name ?? 'N/A'}`,
            `Package: ${pkg?.name ?? 'N/A'}`,
            `Curriculum: ${curriculum?.name ?? 'N/A'}`,
            studentUser ? `Student: ${studentUser.first_name ?? ''} ${studentUser.last_name ?? ''} (${studentUser.email ?? ''})` : '',
            tutorUser ? `Tutor: ${tutorUser.first_name ?? ''} ${tutorUser.last_name ?? ''} (${tutorUser.email ?? ''})` : '',

        ].filter(Boolean).join('\\n');

        const location = session?.meet_link ?? '';

        // Build ICS content — RFC5545 minimal
        const ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//K12Tutoring//EN',
            'CALSCALE:GREGORIAN',
            `METHOD:REQUEST`,
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART:${dtstart}`,
            `DTEND:${dtend}`,
            `SUMMARY:${this.safeText(summary)}`,
            `DESCRIPTION:${this.safeText(descriptionParts)}`,
            location ? `LOCATION:${this.safeText(location)}` : '',
            `END:VEVENT`,
            'END:VCALENDAR',
        ]
            .filter(Boolean)
            .join('\r\n');

        return ics;
    }
}