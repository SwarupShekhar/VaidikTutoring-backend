import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { TutorStatusGuard } from '../auth/tutor-status.guard';
import { PasswordChangeGuard } from '../auth/password-change.guard';
import { TutorsService } from './tutors.service';

@Controller('tutor')
@UseGuards(ClerkAuthGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
export class TutorsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly tutorsService: TutorsService
  ) { }

  @Get('stats')
  async getStats(@Req() req: any) {
    // Update last_seen timestamp when tutor accesses dashboard
    this.tutorsService.updateLastSeen(req.user.userId).catch(err =>
      console.error('Failed to update last_seen:', err.message)
    );
    return this.tutorsService.getTutorStats(req.user.userId);
  }

  @Get('bookings')
  async getBookings(@Req() req: any) {
    if (req.user.role !== 'tutor' && req.user.role !== 'admin')
      throw new UnauthorizedException('Access denied.');

    // Update last_seen timestamp when tutor accesses bookings
    this.tutorsService.updateLastSeen(req.user.userId).catch(err =>
      console.error('Failed to update last_seen:', err.message)
    );

    const bookings = await this.bookingsService.forTutor(req.user.userId);

    // Transform for frontend
    return bookings.map(b => ({
      id: b.id,
      start_time: b.sessions?.[0]?.start_time || b.requested_start,
      end_time: b.sessions?.[0]?.end_time || b.requested_end,
      date: b.sessions?.[0]?.start_time || b.requested_start,
      status: b.status,
      subject_name: b.subjects?.name || 'Unknown Subject',
      child_name: b.students ? `${b.students.first_name} ${b.students.last_name || ''}`.trim() : 'Unknown Student',
      student_id: b.student_id,
      note: b.note,
      meet_link: b.sessions?.[0]?.meet_link,
      whiteboard_link: b.sessions?.[0]?.whiteboard_link
    }));
  }

  @Get('reviews')
  async getReviews(@Req() req: any) {
    return this.tutorsService.getTutorReviews(req.user.userId);
  }

  @Get('me')
  async getMe(@Req() req: any) {
    return this.tutorsService.getTutorProfile(req.user.userId);
  }

  @Patch('me')
  async updateMe(
    @Req() req: any,
    @Body()
    body: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      bio?: string;
      qualifications?: string[];
      skills?: string[];
    },
  ) {
    try {
      return await this.tutorsService.updateTutorProfile(req.user.userId, body);
    } catch (e: any) {
      // Unique-constraint clash (phone is @unique)
      if (e?.code === 'P2002') {
        throw new BadRequestException('That phone number is already in use.');
      }
      throw e;
    }
  }

  // Students this tutor has actually taught (+ their past sessions) — powers the
  // post-session "share notes/files" picker. Server-side share eligibility is
  // re-enforced in sessions.service.shareNote.
  @Get('my-students')
  async getMyStudents(@Req() req: any) {
    if (req.user.role !== 'tutor' && req.user.role !== 'admin')
      throw new UnauthorizedException('Access denied.');
    return this.tutorsService.getMyStudents(req.user.userId);
  }
}
