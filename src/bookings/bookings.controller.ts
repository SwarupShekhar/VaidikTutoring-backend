// src/bookings/bookings.controller.ts
import { Controller, Post, Body, UseGuards, Req, Get, Param, Patch } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { CreateBookingDto } from './create-booking.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Roles } from '../common/decorators/roles.decorators.js';
import { RolesGuard } from '../common/guards/roles.guard.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly svc: BookingsService) { }

  // Student/Parent creates a booking
  @UseGuards(JwtAuthGuard, RolesGuard)
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

  // Tutor fetch assigned bookings
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('tutor')
  @Get('tutor')
  async tutorBookings(@Req() req) {
    return this.svc.forTutor(req.user.userId);
  }

  // Tutor: get available (unclaimed) bookings
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('tutor')
  @Get('available')
  async availableBookings(@Req() req) {
    return this.svc.getAvailableForTutor(req.user.userId);
  }

  // Admin: reassign a booking to a tutor
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch(':id/reassign/:tutorId')
  async reassign(@Param('id') id: string, @Param('tutorId') tutorId: string) {
    return this.svc.reassign(id, tutorId);
  }

  // Feature 6: Broadcast & Claim
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('tutor')
  @Post(':id/claim')
  async claimBooking(@Param('id') id: string, @Req() req) {
    return this.svc.claimBooking(id, req.user.userId);
  }
}
