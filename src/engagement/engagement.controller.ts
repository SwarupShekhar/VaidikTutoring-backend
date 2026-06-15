import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { EngagementService } from './engagement.service';

/**
 * Public one-tap email endpoints (no auth — protected by HMAC-signed tokens):
 *   GET /r/:token?a=<answer>   record an MCQ answer, redirect to /thanks
 *   GET /u/:token              unsubscribe (set users.email_opted_out)
 */
@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  /** Record an MCQ answer tapped from an email, then redirect to the thank-you page. */
  @Get('r/:token')
  async recordAnswer(
    @Param('token') token: string,
    @Query('a') answer: string,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.engagement.recordAnswer(token, answer);
    res.redirect(302, target);
  }

  /** Unsubscribe (or resubscribe with ?resub=1), then redirect to the confirmation page. */
  @Get('u/:token')
  async unsubscribe(
    @Param('token') token: string,
    @Query('resub') resub: string,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.engagement.setOptOut(token, Boolean(resub));
    res.redirect(302, target);
  }
}
