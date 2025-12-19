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

@Controller('tutor')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
export class TutorsController {
  constructor(private readonly bookingsService: BookingsService) { }

  @Get('bookings')
  async getBookings(@Req() req: any) {
    if (req.user.role !== 'tutor')
      throw new UnauthorizedException('Only tutors can access this.');
    console.log('[GET /tutor/bookings] User:', req.user);
    const bookings = await this.bookingsService.forTutor(req.user.userId);
    console.log('[GET /tutor/bookings] Found bookings:', bookings.length);
    return bookings;
  }
}
