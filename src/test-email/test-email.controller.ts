import { Controller, Get, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Controller('test-email')
export class TestEmailController {
  private logger = new Logger(TestEmailController.name);

  @Get()
  async sendTestEmail() {
    // Read SMTP settings from env
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.EMAIL_FROM || 'no-reply@example.com';
    const to = process.env.TEST_EMAIL_TO || user || 'to@example.com';

    if (!host || !user || !pass) {
      return {
        ok: false,
        error: 'SMTP not configured in .env (SMTP_HOST/SMTP_USER/SMTP_PASS)',
      };
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true', // usually false for Mailtrap sandbox
      auth: { user, pass },
    });

    try {
      const info = await transporter.sendMail({
        from,
        to,
        subject: 'K12 Backend — SMTP test',
        text: 'This is a quick SMTP test from your K12 backend. If you see this in Mailtrap, SMTP works.',
      });

      this.logger.log('SMTP send info: ' + JSON.stringify(info));
      return { ok: true, info };
    } catch (err) {
      this.logger.error('SMTP send failed', err);
      return { ok: false, error: String(err) };
    }
  }
}
