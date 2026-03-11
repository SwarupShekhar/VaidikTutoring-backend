import { Injectable, BadRequestException, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Grant credits to user after successful payment
   * Implements: Credit Reset every 30 days, No roll-over
   */
  async grantCredits(userId: string, packageId: string): Promise<void> {
    // Get package details
    const pkg = await this.prisma.packages.findUnique({
      where: { id: packageId },
    });

    if (!pkg || !pkg.active) {
      throw new BadRequestException('Package not found or inactive');
    }

    // Calculate credits based on package (1 credit = 1 session = 30 mins)
    const creditsTotal = this.calculateCreditsFromPackage(pkg);

    // Create or update user credits
    const existingCredits = await this.prisma.user_credits.findFirst({
      where: { 
        user_id: userId,
        reset_date: new Date() // Current period
      },
    });

    if (existingCredits) {
      // Add to existing credits (shouldn't happen normally but handle edge case)
      await this.prisma.user_credits.update({
        where: { id: existingCredits.id },
        data: {
          credits_total: existingCredits.credits_total + creditsTotal,
          updated_at: new Date(),
        },
      });
    } else {
      // Create new credit entry
      await this.prisma.user_credits.create({
        data: {
          user_id: userId,
          package_id: packageId,
          credits_total: creditsTotal,
          reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        },
      });
    }

    this.logger.log(`Granted ${creditsTotal} credits to user ${userId} for package ${packageId}`);
  }

  /**
   * Check if user has sufficient credits for a session
   * Implements: Access Control - User.sessions_left > 0 required
   */
  async checkCredits(userId: string): Promise<{ hasCredits: boolean; creditsRemaining: number }> {
    const userCredits = await this.prisma.user_credits.findFirst({
      where: { 
        user_id: userId,
        reset_date: { gt: new Date() }, // Current period only
      },
      orderBy: { created_at: 'desc' },
    });

    if (!userCredits) {
      return { hasCredits: false, creditsRemaining: 0 };
    }

    const creditsRemaining = userCredits.credits_total - userCredits.credits_used;
    return {
      hasCredits: creditsRemaining > 0,
      creditsRemaining: Math.max(0, creditsRemaining),
    };
  }

  /**
   * Consume credits for a session
   * Implements: Post-Session Hook - Trigger AI Transcription
   */
  async consumeCredits(userId: string, sessionId: string, credits: number = 1): Promise<void> {
    // Check credits first
    const { hasCredits, creditsRemaining } = await this.checkCredits(userId);
    
    if (!hasCredits) {
      throw new ForbiddenException('Insufficient credits for session');
    }

    // Get current credit record
    const userCredits = await this.prisma.user_credits.findFirst({
      where: { 
        user_id: userId,
        reset_date: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!userCredits) {
      throw new BadRequestException('No active credit subscription found');
    }

    // Update credits used
    await this.prisma.user_credits.update({
      where: { id: userCredits.id },
      data: {
        credits_used: userCredits.credits_used + credits,
        updated_at: new Date(),
      },
    });

    // Log usage
    await this.prisma.credit_usage_logs.create({
      data: {
        user_id: userId,
        session_id: sessionId,
        credits_used: credits,
        notes: `Session completed - ${credits} credit(s) consumed`,
      },
    });

    this.logger.log(`Consumed ${credits} credits from user ${userId} for session ${sessionId}`);

    // TODO: Trigger AI Transcription service
    // This would call your AI service to generate transcript + summary
    // await this.aiService.generateTranscript(sessionId);
  }

  /**
   * Reset credits monthly (cron job)
   * Implements: Credit Reset every 30 days. No roll-over
   */
  async resetExpiredCredits(): Promise<void> {
    const expiredCredits = await this.prisma.user_credits.findMany({
      where: {
        reset_date: { lte: new Date() },
      },
    });

    for (const credit of expiredCredits) {
      // Archive old credits (keep for history)
      await this.prisma.user_credits.update({
        where: { id: credit.id },
        data: {
          reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // New period
          credits_total: 0, // Reset to 0 (no roll-over)
          credits_used: 0,
          updated_at: new Date(),
        },
      });

      this.logger.log(`Reset credits for user ${credit.user_id}`);
    }
  }

  /**
   * Get user's credit status
   */
  async getUserCreditStatus(userId: string) {
    const userCredits = await this.prisma.user_credits.findFirst({
      where: { 
        user_id: userId,
        reset_date: { gt: new Date() },
      },
      include: {
        packages: true,
      },
      orderBy: { created_at: 'desc' },
    });

    if (!userCredits) {
      return {
        hasSubscription: false,
        creditsTotal: 0,
        creditsUsed: 0,
        creditsRemaining: 0,
        resetDate: null,
        package: null,
      };
    }

    const creditsRemaining = userCredits.credits_total - userCredits.credits_used;

    return {
      hasSubscription: true,
      creditsTotal: userCredits.credits_total,
      creditsUsed: userCredits.credits_used,
      creditsRemaining: Math.max(0, creditsRemaining),
      resetDate: userCredits.reset_date,
      package: userCredits.packages,
    };
  }

  /**
   * Calculate credits from package
   * Based on pricing structure:
   * - Foundation: 8 credits (2 sessions/week)
   * - Mastery: 16 credits (4 sessions/week) 
   * - Elite: 24 credits (6 sessions/week)
   */
  private calculateCreditsFromPackage(pkg: any): number {
    const name = pkg.name.toLowerCase();
    
    if (name.includes('foundation')) return 8;
    if (name.includes('mastery')) return 16;
    if (name.includes('elite')) return 24;
    
    // Default fallback
    return 8;
  }
}
