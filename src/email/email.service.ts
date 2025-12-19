// src/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private logger = new Logger(EmailService.name);

  private getTransporter() {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === 'true';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP not fully configured (SMTP_HOST/SMTP_USER/SMTP_PASS). Emails will fail.',
      );
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    return this.transporter;
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
    const transporter = this.getTransporter();
    const from =
      opts.from || process.env.EMAIL_FROM || 'no-reply@k12tutoring.local';

    const info = await transporter.sendMail({
      from,
      to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });

    this.logger.log(
      `Email sent: ${info && info.messageId ? info.messageId : JSON.stringify(info)}`,
    );
    return info;
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
    const verificationUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/verify-email?token=${token}`
      : `http://localhost:3000/verify-email?token=${token}`;

    return this.sendMail({
      to,
      subject: 'Verify your email - K12 Tutoring',
      html: `
        <h1>Welcome to K12 Tutoring!</h1>
        <p>Please click the link below to verify your email address:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p>This link will expire in 24 hours.</p>
      `,
    });
  }
}
