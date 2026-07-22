import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class DailyWebhookGuard implements CanActivate {
  private readonly logger = new Logger(DailyWebhookGuard.name);

  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signatureHeader = request.headers['x-webhook-signature'] as string;
    const secret = this.config.get<string>('DAILY_WEBHOOK_SECRET');

    if (!secret) {
      this.logger.error('DAILY_WEBHOOK_SECRET not configured — rejecting webhook');
      throw new UnauthorizedException('Webhook not configured');
    }

    // Daily test payload bypass (to allow webhook creation)
    if (request.body && request.body.test === 'test') {
      this.logger.log('Bypassing signature validation for Daily test payload');
      return true;
    }

    if (!signatureHeader) {
      this.logger.warn('Missing X-Webhook-Signature header');
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Parse t=<timestamp>,v1=<sig>
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((p) => p.split('=')),
    );
    const timestamp = parts['t'];
    const receivedSig = parts['v1'];

    if (!timestamp || !receivedSig) {
      this.logger.warn('Malformed Daily-Signature header');
      throw new UnauthorizedException('Invalid webhook signature format');
    }

    const tsInt = parseInt(timestamp, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(tsInt) || Math.abs(nowSec - tsInt) > 300) {
      this.logger.warn(`Webhook timestamp outside 5-minute window: ${timestamp}`);
      throw new UnauthorizedException('Webhook timestamp expired');
    }

    const rawBody = (request as any).rawBody ?? '';
    const signed = `${timestamp}.${rawBody}`;

    const expected = crypto
      .createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(signed)
      .digest('base64');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(receivedSig, 'utf8');

    if (
      expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      this.logger.warn('Daily webhook signature mismatch');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
