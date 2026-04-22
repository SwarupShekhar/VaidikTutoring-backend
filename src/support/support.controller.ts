import { Controller, Post, Get, Patch, Body, Param, UseGuards, Req, Query, ForbiddenException } from '@nestjs/common';
import { SupportService } from './support.service';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';

@Controller('support')
@UseGuards(ClerkAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('contact')
  async contact(@Req() req: any, @Body() body: { message: string; context?: any }) {
    return this.supportService.submitRequest(req.user.userId, body.message, body.context);
  }

  // ── ADMIN ONLY ────────────────────────────────────────────────────

  @Get('tickets')
  async getTickets(@Req() req: any, @Query('status') status?: string) {
    if (req.user.role !== 'admin') throw new ForbiddenException();
    return this.supportService.getTickets(status);
  }

  @Patch('tickets/:id')
  async updateTicket(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { status: string; admin_note?: string },
  ) {
    if (req.user.role !== 'admin') throw new ForbiddenException();
    return this.supportService.updateTicket(id, body.status, body.admin_note);
  }
}
