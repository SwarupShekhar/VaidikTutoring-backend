import {
  Controller,
  Get,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { TutorStatusGuard } from '../auth/tutor-status.guard';
import { PasswordChangeGuard } from '../auth/password-change.guard';
import { TutorsService } from './tutors.service';

@Controller('tutor')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
export class TutorsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly tutorsService: TutorsService
  ) { }

  @Get('stats')
  async getStats(@Req() req: any) {
    return this.tutorsService.getTutorStats(req.user.userId);
  }

  @Get('bookings')
  async getBookings(@Req() req: any) {
    if (req.user.role !== 'tutor' && req.user.role !== 'admin')
      throw new UnauthorizedException('Access denied.');

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
}
