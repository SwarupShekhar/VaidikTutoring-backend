import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

// Extend Request type to include user from Clerk auth
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
      };
      ip?: string;
      headers: any;
    }
  }
}

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private paymentsService: PaymentsService) {}

  /**
   * Create a Razorpay order
   * Protected by Clerk JWT auth
   */
  @Post('create-order')
  @UseGuards(ClerkAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 3600000 } }) // 10 requests per hour per user
  async createOrder(@Body() dto: CreateOrderDto, @Req() req: any) {
    const userId = req.user?.id;
    
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
    const userAgent = req.headers['user-agent'];

    this.logger.log(`Creating order for user ${userId}, package ${dto.packageId}`);

    return this.paymentsService.createOrder(userId, dto.packageId, ip, userAgent);
  }

  /**
   * Verify payment signature
   * Protected by Clerk JWT auth
   */
  @Post('verify')
  @UseGuards(ClerkAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 requests per 5 minutes per user
  async verifyPayment(@Body() dto: VerifyPaymentDto, @Req() req: any) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    this.logger.log(`Verifying payment for order ${dto.razorpayOrderId}`);

    return this.paymentsService.verifyPayment(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    );
  }

  /**
   * Webhook endpoint for Razorpay events
   * Protected by webhook signature validation (not user auth)
   */
  @Post('webhook')
  @UseGuards(WebhookSignatureGuard)
  async handleWebhook(@Body() payload: any) {
    this.logger.log(`Received webhook: ${payload.event}`);
    return this.paymentsService.processWebhook(payload);
  }
}
