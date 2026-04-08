import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata';
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

  async sendOtp(phone: string, channel: 'sms' | 'whatsapp'): Promise<{ success: boolean }> {
    try {
      await this.twilioClient.verify.v2
        .services(this.verifySid)
        .verifications.create({ to: phone, channel });

      this.logger.log(`OTP sent via ${channel} to ${phone}`);
      return { success: true };
    } catch (err) {
      this.logger.error(`Failed to send OTP to ${phone}: ${err.message}`);
      throw new BadRequestException(`Failed to send verification code: ${err.message}`);
    }
  }

  async verifyOtp(
    userId: string,
    phone: string,
    code: string,
  ): Promise<{ success: boolean }> {
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

    await this.prisma.users.update({
      where: { id: userId },
      data: { phone, phone_verified: true },
    });

    await this.syncClerkService.syncPhoneVerifiedToClerk(userId, true);

    this.logger.log(`Phone verified for user ${userId}`);
    return { success: true };
  }
}
