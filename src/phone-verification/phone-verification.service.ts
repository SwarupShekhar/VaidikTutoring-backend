import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Twilio = require('twilio');

@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);
  private _twilioClient: any = null;
  private readonly verifySid: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncClerkService: SyncClerkMetadataService,
  ) {
    this.verifySid = process.env.TWILIO_VERIFY_SERVICE_SID ?? '';
  }

  private get twilioClient(): any {
    if (!this._twilioClient) {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !token) {
        throw new BadRequestException('Twilio credentials not configured');
      }
      this._twilioClient = Twilio(sid, token);
    }
    return this._twilioClient;
  }

  async validateCaptcha(token: string): Promise<void> {
    const secret = process.env.HCAPTCHA_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new BadRequestException('Server misconfigured: CAPTCHA validation required');
      }
      this.logger.warn('HCAPTCHA_SECRET not configured, skipping captcha validation');
      return;
    }

    try {
      const response = await fetch('https://hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `response=${token}&secret=${secret}`,
      });
      const data = await response.json() as any;
      if (!data.success) {
        throw new BadRequestException('Invalid captcha. Please try again.');
      }
    } catch (err) {
      this.logger.error(`Captcha verification failed: ${err.message}`);
      throw new BadRequestException('Captcha verification failed');
    }
  }

  async sendOtp(userId: string | undefined, phone: string, channel: 'sms' | 'whatsapp', captchaToken: string): Promise<{ success: boolean }> {
    // 0. Validate CAPTCHA first to reject bots early
    await this.validateCaptcha(captchaToken);

    // 1. Validate phone number deliverability
    const phoneNumber = parsePhoneNumberFromString(phone);
    if (!phoneNumber || !phoneNumber.isValid()) {
      throw new BadRequestException('Invalid phone number format. Please provide a valid international number.');
    }

    // 2. Check if current user is already verified
    const currentUser = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { phone_verified: true },
    });

    if (currentUser?.phone_verified) {
      return { success: true }; // Already verified, just return success
    }

    // 3. Check if phone is already verified by another user
    const existing = await this.prisma.users.findFirst({
      where: {
        phone,
        phone_verified: true,
        id: { not: userId },
      },
    });

    if (existing) {
      throw new BadRequestException('Verification failed. If this number is correct, it may already be linked to another account.');
    }

    try {
      await this.twilioClient.verify.v2
        .services(this.verifySid)
        .verifications.create({ to: phone, channel });

      // Audit Log
      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: userId,
          action: 'OTP_SENT',
          object_type: 'USER',
          object_id: userId,
          details: { phone, channel },
        },
      });

      this.logger.log(`OTP sent via ${channel} to ${phone}`);
      return { success: true };
    } catch (err) {
      this.logger.error(`Failed to send OTP to ${phone}: ${err.message}`);
      throw new BadRequestException('Failed to send verification code. Please check the number and try again.');
    }
  }

  async verifyOtp(
    userId: string,
    phone: string,
    code: string,
  ): Promise<{ success: boolean }> {
    // 1. Check if phone is already verified by someone else
    const existing = await this.prisma.users.findFirst({
      where: {
        phone,
        phone_verified: true,
        id: { not: userId },
      },
    });

    if (existing) {
      throw new BadRequestException('This phone number is already verified by another account.');
    }

    let check: any;
    try {
      check = await this.twilioClient.verify.v2
        .services(this.verifySid)
        .verificationChecks.create({ to: phone, code });
    } catch (err) {
      this.logger.error(`Twilio check error for ${phone}: ${err.message}`);
      throw new BadRequestException('Verification failed. Please try again.');
    }

    if (check.status !== 'approved') {
      throw new BadRequestException('Incorrect or expired code. Please try again.');
    }

    // 4. Update user verification status with idempotency check
    await this.prisma.users.update({
      where: { 
        id: userId,
        phone_verified: false // only update if not already verified
      },
      data: {
        phone,
        phone_verified: true,
      },
    });

    // Audit Log Success
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: 'PHONE_VERIFIED',
        object_type: 'USER',
        object_id: userId,
        details: { phone },
      },
    });

    await this.syncClerkService.syncPhoneVerifiedToClerk(userId, true);

    this.logger.log(`Phone verified for user ${userId}`);
    return { success: true };
  }
}
