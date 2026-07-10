import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly webhookUrl = process.env.SLACK_CHANNEL_WEBHOOK;

  async sendAlert(message: string) {
    if (!this.webhookUrl) {
      this.logger.warn('SLACK_CHANNEL_WEBHOOK not configured. Alert skipped.');
      return;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: `@studyhours ${message}`
        }),
      });

      if (!response.ok) {
        this.logger.error(`Slack webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send slack alert: ${error.message}`);
    }
  }
}
