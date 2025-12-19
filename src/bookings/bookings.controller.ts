// src/bookings/bookings.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Patch,
} from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { CreateBookingDto } from './create-booking.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Roles } from '../common/decorators/roles.decorators.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { EmailVerifiedGuard } from '../auth/email-verified.guard.js';
import { PasswordChangeGuard } from '../auth/password-change.guard.js';
import { TutorStatusGuard } from '../auth/tutor-status.guard.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly svc: BookingsService) { }

  // Student/Parent creates a booking
  @UseGuards(JwtAuthGuard, RolesGuard, EmailVerifiedGuard)
  @Roles('parent', 'student')
  @Post('create')
  async create(@Body() dto: CreateBookingDto, @Req() req) {
    // ensure the caller is the parent of the student or the student themself
    return this.svc.create(dto, req.user);
  }

  // Explicit endpoint for student bookings
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student')
  @Get('student')
  async studentBookings(@Req() req) {
    return this.svc.forStudent(req.user.userId);
  }

  // Student fetch own bookings
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student', 'parent')
  @Get('mine')
  async myBookings(@Req() req) {
    if (req.user.role === 'student') {
      return this.svc.forStudent(req.user.userId);
    }
    // parent: return bookings for their children
    return this.svc.forParent(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('parent')
  @Get('parent')
  async parentBookings(@Req() req) {
    return this.svc.forParent(req.user.userId);
  }

  // Tutor fetch assigned bookings (Legacy /bookings/tutor)
  @UseGuards(JwtAuthGuard, RolesGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
  @Roles('tutor')
  @Get('tutor')
  async tutorBookings(@Req() req) {
    return this.svc.forTutor(req.user.userId);
  }

  // NEW: Tutor Dashboard Endpoints (Match specific requirements)
  // Path: /bookings/tutor/bookings
  @Get('tutor/bookings')
  @UseGuards(JwtAuthGuard, RolesGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
  @Roles('tutor')
  async getTutorBookings(@Req() req) {
    const bookings = await this.svc.forTutor(req.user.userId);

    // Transform to match frontend expectations
    return bookings.map(b => ({
      id: b.id,
      start_time: b.sessions?.[0]?.start_time || b.requested_start,
      end_time: b.sessions?.[0]?.end_time || b.requested_end,
      date: b.sessions?.[0]?.start_time || b.requested_start, // Alias for compatibility
      status: b.status,
      subject_name: b.subjects?.name || 'Unknown Subject',
      child_name: b.students ? `${b.students.first_name} ${b.students.last_name || ''}`.trim() : 'Unknown Student',
      student_id: b.student_id,
      note: b.note,
      meet_link: b.sessions?.[0]?.meet_link
    }));
  }

  // Tutor: get available (unclaimed) bookings
  // Path: /bookings/available
  @UseGuards(JwtAuthGuard, RolesGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
  @Roles('tutor')
  @Get('available')
  async availableBookings(@Req() req) {
    // This was previously defined but let's update it to match the requested format if needed
    const available = await this.svc.getAvailableForTutor(req.user.userId);

    // Transform for "Available Jobs" view
    return available.map(b => ({
      id: b.id,
      subject_name: b.subjects?.name,
      requested_start: b.requested_start,
      student_name: b.students ? `${b.students.first_name} ${b.students.last_name || ''}`.trim() : 'Unknown Student',
      note: b.note
    }));
  }

  // Admin: reassign a booking to a tutor
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch(':id/reassign/:tutorId')
  async reassign(@Param('id') id: string, @Param('tutorId') tutorId: string) {
    return this.svc.reassign(id, tutorId);
  }

  // Feature 6: Broadcast & Claim
  @UseGuards(JwtAuthGuard, RolesGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
  @Roles('tutor')
  @Post(':id/claim')
  async claimBooking(@Param('id') id: string, @Req() req) {
    return this.svc.claimBooking(id, req.user.userId);
  }

  // Get single booking by ID (for session page)
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getBookingById(@Param('id') id: string, @Req() req) {
    return this.svc.getBookingById(id, req.user);
  }
}
