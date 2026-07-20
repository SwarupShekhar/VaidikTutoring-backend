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

  @Post('test-prep')
  async captureTestPrep(@Body() body: { name: string; email: string; phone: string; target_test: string }) {
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      throw new BadRequestException('Valid email required');
    }
    if (!body.name || !body.phone || !body.target_test) {
      throw new BadRequestException('Name, phone, and target test are required');
    }

    // Anti-spam validation
    const phoneDigits = body.phone.replace(/[^0-9]/g, '');
    if (phoneDigits.length < 7 || phoneDigits.length > 15 || /[a-zA-Z]/.test(body.phone)) {
      throw new BadRequestException('Please enter a valid phone number');
    }

    if (/[0-9]{3,}/.test(body.name)) {
      throw new BadRequestException('Please enter a valid name');
    }

    if (['x@gmail.com', 'test@test.com'].includes(body.email.toLowerCase().trim())) {
      throw new BadRequestException('Please use a real email address');
    }
    return this.leadsService.captureTestPrep({
      name: body.name.trim(),
      email: body.email.toLowerCase().trim(),
      phone: body.phone.trim(),
      target_test: body.target_test.trim()
    });
  }
}
