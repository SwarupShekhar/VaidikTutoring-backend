import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private resend: Resend;
  private logger = new Logger(EmailService.name);

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    if (!process.env.RESEND_API_KEY) {
      this.logger.warn('RESEND_API_KEY is not set. Emails will fail.');
    }
  }

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
    const from = opts.from || process.env.EMAIL_FROM || 'onboarding@resend.dev';
    const to = Array.isArray(opts.to) ? opts.to : [opts.to];

    try {
      const data = await this.resend.emails.send({
        from,
        to,
        subject: opts.subject,
        html: opts.html || opts.text || '', // Resend requires html or react
        text: opts.text, // Optional plaintext fallback
        attachments: opts.attachments?.map(a => ({
          filename: a.filename,
          content: a.content,
        })),
      });

      this.logger.log(`Email sent via Resend: ${data.data?.id || JSON.stringify(data)}`);
      return data;
    } catch (error) {
      this.logger.error(`Failed to send email via Resend: ${error}`);
      throw error;
    }
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
    // If FRONTEND_URL is set (e.g., https://vaidik-tutoring.vercel.app), use it.
    // Otherwise fallback to localhost.
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Remove trailing slash if present to avoid double slashes
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const verificationUrl = `${cleanBaseUrl}/verify-email?token=${token}`;

    const result = await this.sendMail({
      to,
      subject: 'Verify your email - K12 Tutoring',
      html: `
        <h1>Welcome to K12 Tutoring!</h1>
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
