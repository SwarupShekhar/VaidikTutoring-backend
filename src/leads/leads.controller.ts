import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post('capture')
  async capture(@Body() body: { email: string; source: string }) {
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      throw new BadRequestException('Valid email required');
    }
    return this.leadsService.capture(body.email.toLowerCase().trim(), body.source || 'unknown');
  }
}
