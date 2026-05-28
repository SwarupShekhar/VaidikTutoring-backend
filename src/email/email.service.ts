import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class EmailService {
  private logger = new Logger(EmailService.name);

  constructor(@InjectQueue('email-queue') private readonly emailQueue: Queue) {}

  async sendMail(opts: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      contentType?: string;
    }>;
    from?: string;
  }) {
    // Add the email job to the queue
    const job = await this.emailQueue.add('sendMail', opts, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    
    this.logger.log(`Enqueued background email job: ${job.id}`);
    return { id: job.id };
  }

  async sendSessionInvite(params: {
    to: string | string[]; // recipient emails
    subject: string;
    plaintext?: string;
    icsContent: string;
    filename?: string;
  }) {
    const filename = params.filename || 'session_invite.ics';
    return this.sendMail({
      to: params.to,
      subject: params.subject,
      text: params.plaintext || 'Please find the session invite attached.',
      attachments: [
        {
          filename,
          content: params.icsContent,
          contentType: 'text/calendar; charset=utf-8',
        },
      ],
    });
  }

  async sendVerificationEmail(to: string, token: string) {
    // Determine Verification URL (Frontend vs Local)
    // If FRONTEND_URL is set (e.g., https://studyhours.com), use it.
    // Otherwise fallback to localhost.
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Remove trailing slash if present to avoid double slashes
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const verificationUrl = `${cleanBaseUrl}/verify-email?token=${token}`;

    const result = await this.sendMail({
      to,
      subject: 'Verify your email - StudyHours',
      html: `
        <h1>Welcome to StudyHours!</h1>
        <p>Please click the link below to verify your email address:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p>This link will expire in 24 hours.</p>
      `,
    });

    // DEBUG: Log the link for local development
    this.logger.log(`[EmailService] Verification URL: ${verificationUrl}`);

    return result;
  }
}
