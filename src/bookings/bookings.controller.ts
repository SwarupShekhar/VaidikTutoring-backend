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
    // Basic check: if caller is student same id, or if parent owns the student
    // The service itself verifies existence; for extra security you can add checks here.
    return this.svc.create(dto);
  }

  // Explicit endpoint for student bookings
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student')
  @Get('student')
  async studentBookings(@Req() req) {
    return this.svc.forStudent(req.user.sub);
  }

  // Student fetch own bookings
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student', 'parent')
  @Get('mine')
  async myBookings(@Req() req) {
    if (req.user.role === 'student') {
      return this.svc.forStudent(req.user.sub);
    }
    // parent: return bookings for their children
    return this.svc.forParent(req.user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('parent')
  @Get('parent')
  async parentBookings(@Req() req) {
    return this.svc.forParent(req.user.sub);
  }

  // Tutor fetch assigned bookings
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('tutor')
  @Get('tutor')
  async tutorBookings(@Req() req) {
    return this.svc.forTutor(req.user.sub);
  }

  // Admin: reassign a booking to a tutor
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch(':id/reassign/:tutorId')
  async reassign(@Param('id') id: string, @Param('tutorId') tutorId: string) {
    return this.svc.reassign(id, tutorId);
  }
}
