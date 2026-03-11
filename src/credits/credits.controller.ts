import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  BadRequestException,
  Logger,
  Param,
} from '@nestjs/common';
import { CreditsService } from './credits.service';

// Extend Request type to include user from Clerk auth
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
      };
    }
  }
}

@Controller('credits')
export class CreditsController {
  private readonly logger = new Logger(CreditsController.name);

  constructor(private creditsService: CreditsService) {}

  /**
   * Get user's credit status
   * Protected by Clerk JWT auth
   */
  @Get('status')
  async getCreditStatus(@Req() req: Express.Request) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    this.logger.log(`Getting credit status for user ${userId}`);

    return this.creditsService.getUserCreditStatus(userId);
  }

  /**
   * Check if user has sufficient credits for a session
   * This is called before allowing user to join a live session
   * Implements: Access Control - User.sessions_left > 0 required
   */
  @Get('check')
  async checkCredits(@Req() req: Express.Request) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    this.logger.log(`Checking credits for user ${userId}`);

    return this.creditsService.checkCredits(userId);
  }

  /**
   * Consume credits for a completed session
   * This is called after a session ends
   * Implements: Post-Session Hook - Trigger AI Transcription
   */
  @Post('consume/:sessionId')
  async consumeCredits(
    @Param('sessionId') sessionId: string,
    @Req() req: Express.Request,
  ) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    this.logger.log(`Consuming credits for user ${userId}, session ${sessionId}`);

    await this.creditsService.consumeCredits(userId, sessionId, 1);

    return { success: true, message: 'Credits consumed successfully' };
  }
}
