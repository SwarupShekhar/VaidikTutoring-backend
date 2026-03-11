import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['x-razorpay-signature'];
    const secret = this.config.get('RAZORPAY_WEBHOOK_SECRET');

    if (!signature) {
      this.logger.warn('Missing Razorpay webhook signature');
      throw new ForbiddenException('Missing webhook signature');
    }

    if (!secret) {
      this.logger.error('RAZORPAY_WEBHOOK_SECRET not configured');
      throw new ForbiddenException('Webhook configuration error');
    }

    // Get raw body for signature verification
    const rawBody = (request as any).rawBody;
    
    if (!rawBody) {
      this.logger.error('Raw body not available - ensure RawBodyMiddleware is configured');
      throw new ForbiddenException('Webhook processing error');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (signatureBuffer.length !== expectedBuffer.length || 
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      this.logger.warn('Invalid webhook signature');
      throw new ForbiddenException('Invalid webhook signature');
    }

    return true;
  }
}
