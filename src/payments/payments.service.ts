import { Injectable, BadRequestException, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { CreditsService } from '../credits/credits.service';
import { AdminAlertsService } from '../notifications/admin-alerts.service';

export interface CreateOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  packageName: string;
  packageDescription?: string;
  creditsIncluded?: number;
  billingType?: string;
}

export interface VerifyPaymentResponse {
  success: boolean;
  purchaseId?: string;
  alreadyVerified?: boolean;
  studentId?: string;
}

@Injectable()
export class PaymentsService {
  private razorpay: Razorpay | null = null;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private creditsService: CreditsService,
    private adminAlerts: AdminAlertsService,
  ) {
    // Lazy initialization - only create Razorpay instance when credentials are available
    this.initializeRazorpay();
  }

  private initializeRazorpay() {
    const keyId = this.config.get('RAZORPAY_KEY_ID');
    const keySecret = this.config.get('RAZORPAY_KEY_SECRET');

    if (!keyId || !keySecret) {
      this.logger.warn('Razorpay credentials not configured. Payment features will be disabled.');
      return;
    }

    try {
      this.razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
      this.logger.log('Razorpay initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Razorpay:', error);
      this.razorpay = null;
    }
  }

  private ensureRazorpayInitialized() {
    if (!this.razorpay) {
      throw new BadRequestException('Payment service is not available. Please configure Razorpay credentials.');
    }
  }

  /**
   * Sync exchange rates daily
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async syncExchangeRates() {
    this.logger.log('Starting daily exchange rate sync...');
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      
      if (data && data.rates) {
        const rates = data.rates;
        for (const [currency, rate_to_usd] of Object.entries(rates)) {
          await this.prisma.exchange_rates.upsert({
            where: { currency },
            update: { rate_to_usd: rate_to_usd as number, last_updated: new Date() },
            create: { currency, rate_to_usd: rate_to_usd as number }
          });
        }
        this.logger.log('Exchange rates synced successfully');
      }
    } catch (error) {
      this.logger.error('Failed to sync exchange rates:', error);
    }
  }

  /**
   * Create a Razorpay order for a package purchase
   * Adapated for Vaidik Tutoring architecture - uses existing packages table
   */
  async createOrder(userId: string, packageId: string, ip: string, userAgent?: string, couponCode?: string): Promise<CreateOrderResponse> {
    this.ensureRazorpayInitialized();
    
    // Get package from YOUR existing database
    const pkg = await this.prisma.packages.findUnique({
      where: { id: packageId },
      include: {
        package_items: {
          include: { subjects: true }
        }
      },
    });

    if (!pkg || !pkg.active) {
      throw new BadRequestException('Package not available');
    }

    // Calculate total credits included in this package
    const creditsIncluded = pkg.package_items?.reduce((total, item) => total + (item.hours || 0), 0) || 0;

    // Calculate dynamic price if base_price_usd exists
    let dynamicPriceCents = pkg.price_cents || 0;
    let finalCurrency = pkg.currency ?? 'USD';

    if (pkg.base_price_usd) {
      if (finalCurrency === 'USD') {
        dynamicPriceCents = pkg.base_price_usd * 100;
      } else {
        const rateRecord = await this.prisma.exchange_rates.findUnique({
          where: { currency: finalCurrency }
        });
        if (rateRecord) {
          // If rate_to_usd means 1 USD = X currency
          // then dynamic price in target currency = base_price_usd * rate
          dynamicPriceCents = Math.round(pkg.base_price_usd * Number(rateRecord.rate_to_usd) * 100);
        } else {
          this.logger.warn(`No exchange rate found for ${finalCurrency}, falling back to static price`);
        }
      }
    }

    // Apply Coupon / Promo Code Discounts (Universal across all currencies)
    if (couponCode) {
      const code = couponCode.trim().toUpperCase();
      if (code === 'MOMENTUM7') {
        dynamicPriceCents = Math.round(dynamicPriceCents * 0.93);
        this.logger.log(`Applied 7% coupon ${code}: new amount = ${dynamicPriceCents} cents`);
      } else {
        this.logger.warn(`Attempted to use invalid or expired coupon: ${code}`);
      }
    }

    // Create pending purchase record first
    const purchase = await this.prisma.purchases.create({
      data: {
        user_id: userId,
        package_id: packageId,
        amount_cents: dynamicPriceCents,
        currency: finalCurrency,
        status: 'PENDING',
        payment_provider: 'razorpay',
        ip_address: ip,
        user_agent: userAgent,
      },
    });

    // Create Razorpay order
    const order = await this.razorpay!.orders.create({
      amount: dynamicPriceCents, // Razorpay uses paise (smallest unit)
      currency: finalCurrency,
      receipt: purchase.id, // Link back to our DB
      notes: {
        packageId,
        userId,
      },
    });

    // Update purchase with Razorpay order ID
    await this.prisma.purchases.update({
      where: { id: purchase.id },
      data: { razorpay_order_id: order.id },
    });

    this.logger.log(`Created order ${order.id} for user ${userId}, package ${packageId}`);

    return {
      orderId: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      keyId: this.config.get('RAZORPAY_KEY_ID') || '',
      packageName: pkg.name,
      packageDescription: pkg.description || undefined,
      creditsIncluded,
      billingType: pkg.billing_type || undefined,
    };
  }

  /**
   * Verify payment signature from frontend
   * CRITICAL: This is the main security check
   */
  async verifyPayment(
    orderId: string,
    paymentId: string,
    signature: string,
  ): Promise<VerifyPaymentResponse> {
    this.ensureRazorpayInitialized();
    
    // CRITICAL: Verify HMAC-SHA256 signature
    const body = orderId + '|' + paymentId;
    const secret = this.config.get('RAZORPAY_KEY_SECRET') || '';

    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    if (expected !== signature) {
      this.logger.warn(`Invalid signature for order ${orderId}`);
      throw new BadRequestException('Payment verification failed');
    }

    // Fetch payment from Razorpay to verify amount
    try {
      const payment = await this.razorpay!.payments.fetch(paymentId);

      // Get purchase from database using the order_id from database (not frontend)
      const purchase = await this.prisma.purchases.findUnique({
        where: { razorpay_order_id: orderId },
        include: { packages: true },
      });

      if (!purchase) {
        throw new BadRequestException('Purchase not found');
      }

      // Double-validate amount (security critical)
      if (Number(payment.amount) !== purchase.amount_cents) {
        this.logger.error(
          `Amount mismatch: expected ${purchase.amount_cents}, got ${payment.amount}`,
        );
        throw new BadRequestException('Payment amount mismatch');
      }

      // Check if payment already verified to prevent double credit granting
      const existingPayment = await this.prisma.purchases.findFirst({
        where: { razorpay_payment_id: paymentId, status: 'PAID' },
      });

      if (existingPayment) {
        this.logger.warn(`Payment ${paymentId} already verified, skipping credit grant`);
        return {
          success: true,
          purchaseId: existingPayment.id,
          alreadyVerified: true,
        };
      }

      // Update purchase inside transaction to prevent race conditions and lock the row
      const shouldGrantCredits = await this.prisma.$transaction(async (tx) => {
        const [lockedPurchase]: any[] = await tx.$queryRawUnsafe(
          `SELECT * FROM app.purchases WHERE id = $1 FOR UPDATE`,
          purchase.id,
        );

        if (!lockedPurchase) {
          throw new BadRequestException('Purchase not found during locking');
        }

        if (lockedPurchase.credit_granted_at) {
          this.logger.warn(`Payment ${paymentId} already has credits granted, skipping verifyPayment grant`);
          return false;
        }

        // Update purchase to PAID + set credit_granted_at
        await tx.purchases.update({
          where: { id: purchase.id },
          data: {
            status: 'PAID',
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
            verified_at: new Date(),
            credit_granted_at: new Date(),
            payment_method: payment.method || undefined,
            payment_method_detail: {
              card: payment.card ? {
                last4: payment.card.last4,
                network: payment.card.network,
              } : null,
              vpa: payment.vpa || null,
              bank: payment.bank || null,
            },
          },
        });

        return true;
      });

      if (shouldGrantCredits) {
        // Grant credits to user
        await this.creditsService.grantCredits(purchase.user_id!, purchase.package_id!);
      }

      // Track successful payment in audit logs
      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: purchase.user_id,
          action: 'PAYMENT_SUCCESSFUL',
          details: {
            orderId,
            paymentId,
            amount: purchase.amount_cents,
            packageId: purchase.package_id,
          },
        },
      });

      this.logger.log(`Payment verified for order ${orderId}, purchase ${purchase.id}, credits granted status: ${shouldGrantCredits}`);

      // Find the student: parent buying for child, or student buying directly
      const student = await this.prisma.students.findFirst({
        where: {
          OR: [
            { parent_user_id: purchase.user_id },
            { user_id: purchase.user_id },
          ],
        },
      });

      return {
        success: true,
        purchaseId: purchase.id,
        studentId: student?.id,
      };
    } catch (error) {
      this.logger.error(`Payment verification error: ${error}`);
      throw new BadRequestException('Payment verification failed');
    }
  }

  /**
   * Process webhook events from Razorpay
   * Implements idempotent processing to prevent double-charging
   */
  async processWebhook(payload: any): Promise<{ status: string }> {
    const eventId = payload.id;
    const eventType = payload.event;

    // Idempotency: skip if already processed
    const existing = await this.prisma.webhook_events.findUnique({
      where: { event_id: eventId },
    });

    if (existing?.processed) {
      this.logger.log(`Webhook ${eventId} already processed, skipping`);
      return { status: 'already_processed' };
    }

    // Store event
    await this.prisma.webhook_events.upsert({
      where: { event_id: eventId },
      create: {
        event_id: eventId,
        event_type: eventType,
        payload: payload,
      },
      update: {},
    });

    try {
      switch (eventType) {
        case 'payment.captured':
          await this.handlePaymentCaptured(payload.payload.payment.entity);
          break;
        case 'payment.failed':
          await this.handlePaymentFailed(payload.payload.payment.entity);
          break;
        case 'refund.processed':
          await this.handleRefund(payload.payload.refund.entity);
          break;
        default:
          this.logger.warn(`Unhandled webhook event type: ${eventType}`);
      }

      // Mark as processed
      await this.prisma.webhook_events.update({
        where: { event_id: eventId },
        data: { processed: true, processed_at: new Date() },
      });

      return { status: 'processed' };
    } catch (error) {
      // Log error but don't rethrow to prevent Razorpay retries
      await this.prisma.webhook_events.update({
        where: { event_id: eventId },
        data: { error: String(error) },
      });

      this.logger.error(`Webhook processing error: ${error}`);
      return { status: 'error' };
    }
  }

  private async handlePaymentCaptured(payment: any) {
    // Find by payment ID or order ID (to support both race condition cases)
    const purchase = await this.prisma.purchases.findFirst({
      where: {
        OR: [
          { razorpay_payment_id: payment.id },
          { razorpay_order_id: payment.order_id },
        ],
      },
    });

    if (!purchase) {
      this.logger.warn(`No purchase found for payment ${payment.id} or order ${payment.order_id} in webhook`);
      return;
    }

    const shouldGrantCredits = await this.prisma.$transaction(async (tx) => {
      const [lockedPurchase]: any[] = await tx.$queryRawUnsafe(
        `SELECT * FROM app.purchases WHERE id = $1 FOR UPDATE`,
        purchase.id,
      );

      if (!lockedPurchase) {
        return false;
      }

      if (lockedPurchase.credit_granted_at) {
        this.logger.log(`Payment ${payment.id} already has credits granted, skipping webhook grant`);
        return false;
      }

      await tx.purchases.update({
        where: { id: purchase.id },
        data: {
          status: 'PAID',
          razorpay_payment_id: payment.id, // Ensure payment ID is set
          verified_at: lockedPurchase.verified_at ?? new Date(),
          credit_granted_at: new Date(),
        },
      });

      return true;
    });

    // Only grant credits if this is the first time we're marking it PAID
    if (shouldGrantCredits && purchase.user_id && purchase.package_id) {
      await this.creditsService.grantCredits(purchase.user_id, purchase.package_id);
      this.logger.log(`Payment captured for purchase ${purchase.id} via webhook, credits granted`);
    }
  }

  private async handlePaymentFailed(payment: any) {
    const purchase = await this.prisma.purchases.findFirst({
      where: { razorpay_payment_id: payment.id },
    });

    if (purchase) {
      await this.prisma.purchases.update({
        where: { id: purchase.id },
        data: {
          status: 'FAILED',
          failure_reason: payment.error_description || payment.error_reason || 'Payment failed',
        },
      });
      // Alert Admins Proactively
      await this.adminAlerts.notifyPaymentFailure(
        purchase.razorpay_order_id || 'UNKNOWN',
        purchase.user_id || 'No User',
        purchase.amount_cents || 0,
        payment.error_description || payment.error_reason || 'Payment failed'
      );
      this.logger.log(`Payment failed for purchase ${purchase.id}`);
    }
  }

  private async handleRefund(refund: any) {
    const purchase = await this.prisma.purchases.findFirst({
      where: { razorpay_payment_id: refund.payment_id },
    });

    if (purchase) {
      await this.prisma.purchases.update({
        where: { id: purchase.id },
        data: {
          status: 'REFUNDED',
          refund_id: refund.id,
          refunded_at: new Date(),
        },
      });
      this.logger.log(`Refund processed for purchase ${purchase.id}`);

      // GAP 5 FIX: Revoke user credits and pause associated active enrollments!
      if (purchase.user_id) {
        await this.creditsService.revokeCredits(purchase.user_id);
      }
    }
  }

  /**
   * Verify webhook signature from Razorpay
   */
  verifyWebhookSignature(body: string, signature: string): boolean {
    const secret = this.config.get('RAZORPAY_WEBHOOK_SECRET') || '';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    return expected === signature;
  }
}
