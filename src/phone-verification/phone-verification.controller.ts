import {
  Controller, Post, Body, UseGuards, Req,
  BadRequestException,
} from '@nestjs/common';
import { PhoneVerificationService } from './phone-verification.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';

@Controller('phone-verification')
@UseGuards(ClerkAuthGuard)
export class PhoneVerificationController {
  constructor(private readonly phoneVerificationService: PhoneVerificationService) {}

  @Post('send')
  async send(@Body() body: SendOtpDto): Promise<{ success: boolean }> {
    return this.phoneVerificationService.sendOtp(body.phone, body.channel);
  }

  @Post('verify')
  async verify(@Body() body: VerifyOtpDto, @Req() req: any): Promise<{ success: boolean }> {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) throw new BadRequestException('User not identified');
    return this.phoneVerificationService.verifyOtp(userId, body.phone, body.code);
  }
}
