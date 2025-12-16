import { Controller, Get, Param, Res, UseGuards, Req } from '@nestjs/common';
import { InviteService } from './invite.service';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('bookings')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  // GET /bookings/:id/invite
  @UseGuards(JwtAuthGuard)
  @Get(':id/invite')
  async downloadInvite(
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    // req.user should be populated by your JwtAuthGuard and contain sub or id
    const user = (req as any).user;
    const userId = user?.sub || user?.id || null;

    const ics = await this.inviteService.generateIcsForBooking(id, userId);

    const filename = `booking-${id}.ics`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(ics);
  }
}
