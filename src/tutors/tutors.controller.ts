import { Controller, Get, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('tutor')
@UseGuards(JwtAuthGuard)
export class TutorsController {
    constructor(private readonly bookingsService: BookingsService) { }

    @Get('bookings')
    async getBookings(@Req() req: any) {
        if (req.user.role !== 'tutor') throw new UnauthorizedException('Only tutors can access this.');
        return this.bookingsService.forTutor(req.user.userId);
    }
}
