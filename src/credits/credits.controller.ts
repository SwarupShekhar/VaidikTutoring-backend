import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  Body,
  BadRequestException,
  Logger,
  Param,
} from '@nestjs/common';
import { CreditsService } from './credits.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Roles } from '../common/decorators/roles.decorators';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('credits')
export class CreditsController {
  private readonly logger = new Logger(CreditsController.name);

  constructor(
    private creditsService: CreditsService,
    private prisma: PrismaService,
  ) {}

  /**
   * GET /credits/status — legacy subscription-based credit status
   */
  @Get('status')
  async getCreditStatus(@Req() req: any) {
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    this.logger.log(`Getting credit status for user ${userId}`);

    return this.creditsService.getUserCreditStatus(userId);
  }

  /**
   * GET /credits/trial-status — new trial credit status for students
   */
  @Get('trial-status')
  @UseGuards(JwtAuthGuard)
  async getTrialCreditStatus(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new BadRequestException('User not authenticated');

    const student = await this.prisma.students.findFirst({
      where: { user_id: userId },
    });

    if (!student) {
      return {
        mode: 'no_access',
        creditsRemaining: 0,
        trialExpiresAt: null,
        daysLeft: null,
        sessionsUsed: 0,
        canBook: false,
        plan: null,
      };
    }

    return this.creditsService.getCreditStatus(student);
  }

  /**
   * POST /credits/subscribe — subscribe to a plan
   * Requires a verified Razorpay payment_id in the body. Credits are only granted
   * after the payment is confirmed via the payments webhook. This endpoint is
   * intentionally disabled — use POST /payments/verify instead.
   */
  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  async subscribe(@Req() req: any, @Body() body: { plan: string }) {
    // SECURITY: Direct subscription without payment is disabled.
    // All subscriptions must go through the Razorpay payment flow at POST /payments/create-order
    // followed by POST /payments/verify which calls CreditsService.subscribe() after signature verification.
    throw new BadRequestException(
      'Direct subscription is disabled. Please use the payment flow at /payments/create-order.',
    );
  }

  /**
   * POST /credits/admin/grant/:studentId — admin grants credits
   */
  @Post('admin/grant/:studentId')
  @UseGuards(JwtAuthGuard)
  async adminGrantCredits(
    @Param('studentId') studentId: string,
    @Body() body: { credits: number; note: string },
    @Req() req: any,
  ) {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId) throw new BadRequestException('User not authenticated');
    if (role !== 'admin') throw new BadRequestException('Admin access required');

    if (!body.credits || body.credits <= 0) {
      throw new BadRequestException('Credits must be a positive number');
    }

    await this.creditsService.adminGrantCredits(
      studentId,
      body.credits,
      body.note || 'Admin grant',
      userId,
    );

    // Return updated status
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });

    return {
      success: true,
      message: `Granted ${body.credits} credits to student`,
      creditStatus: student ? this.creditsService.getCreditStatus(student) : null,
    };
  }

  /**
   * GET /credits/check — legacy check
   */
  @Get('check')
  async checkCredits(@Req() req: any) {
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    this.logger.log(`Checking credits for user ${userId}`);

    return this.creditsService.checkCredits(userId);
  }

  /**
   * POST /credits/consume/:sessionId — legacy consume
   */
  @Post('consume/:sessionId')
  async consumeCredits(
    @Param('sessionId') sessionId: string,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    this.logger.log(`Consuming credits for user ${userId}, session ${sessionId}`);

    await this.creditsService.consumeCredits(userId, sessionId, 1);

    return { success: true, message: 'Credits consumed successfully' };
  }
}
