import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('contact')
  async contact(@Req() req: any, @Body() body: { message: string; context?: any }) {
    const userId = req.user.userId;
    return this.supportService.submitRequest(userId, body.message, body.context);
  }
}
