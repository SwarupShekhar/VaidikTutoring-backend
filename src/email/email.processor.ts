import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Processor('email-queue')
export class EmailProcessor extends WorkerHost {
  private resend: Resend;
  private logger = new Logger(EmailProcessor.name);

  constructor() {
    super();
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn('RESEND_API_KEY is not set. Emails will fail.');
    }
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const opts = job.data;
    const from = opts.from || process.env.EMAIL_FROM || 'StudyHours <no-reply@studyhours.com>';
    const to = Array.isArray(opts.to) ? opts.to : [opts.to];

    if (!this.resend) {
      throw new Error('RESEND_API_KEY is missing');
    }

    try {
      const result = await this.resend.emails.send({
        from,
        to,
        subject: opts.subject,
        html: opts.html || opts.text || '',
        text: opts.text,
        attachments: opts.attachments,
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      this.logger.log(`[Job ${job.id}] Email sent via Resend: ${result.data?.id}`);
      return result.data;
    } catch (error) {
      this.logger.error(`[Job ${job.id}] Failed to send email via Resend: ${error.message || error}`);
      throw error;
    }
  }
}
