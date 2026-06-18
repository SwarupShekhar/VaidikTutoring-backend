import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { signEngagementToken } from '../engagement/engagement-token';

const FROM = 'StudyHours <hellostudents@studyhours.com>';

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
    replyTo?: string;
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

  // ── Behavioral onboarding emails ────────────────────────────────────────────

  /** Welcome — fired at account creation (no MCQ). */
  async sendWelcomeEmail(to: string, userId: string, firstName?: string, leadSource?: string | null) {
    const name = this.firstName(firstName);
    const frontend = this.frontendBase();
    const leadLine = this.leadContextLine(leadSource);

    const body = `
      <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 12px;line-height:1.2">Welcome to StudyHours, ${name} 👋</h1>
      ${leadLine}
      <p style="color:#e5e5e5;font-size:15px;line-height:1.6;margin:0 0 20px">
        You're one short step away. Tell us what you're working towards and we'll line up the right tutor and a plan built around your exam — it takes about a minute.
      </p>
      <a href="${frontend}/onboarding" style="display:inline-block;background:#4c70f5;color:#fff;text-decoration:none;padding:14px 24px;border-radius:50px;font-weight:700;font-size:15px;margin:0 0 8px">
        Finish setting up →
      </a>
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:16px 0 0">
        Stuck or have a question? Just reply to this email — a real person reads it.
      </p>`;

    return this.sendMail({
      to,
      from: FROM,
      replyTo: FROM,
      subject: name === 'there' ? 'Welcome to StudyHours' : `Welcome to StudyHours, ${name}`,
      html: this.wrapper(body, userId),
    });
  }

  /** MCQ-academic — "what are you working on?" four tap buttons. */
  async sendMcqAcademicEmail(to: string, userId: string, firstName?: string, leadSource?: string | null) {
    const name = this.firstName(firstName);
    const leadLine = this.leadContextLine(leadSource);
    const token = signEngagementToken({ user_id: userId, type: 'mcq_academic' });

    const options: Array<[string, string]> = [
      ['📘 Struggling with a subject', 'subject_help'],
      ['🎯 Prepping for an exam', 'exam_prep'],
      ['📉 Fallen behind, catching up', 'catching_up'],
      ['🚀 Want to get ahead', 'get_ahead'],
    ];

    const body = `
      <h1 style="color:#fff;font-size:24px;font-weight:800;margin:0 0 12px;line-height:1.3">Hey ${name} — quick one</h1>
      ${leadLine}
      <p style="color:#e5e5e5;font-size:15px;line-height:1.6;margin:0 0 20px">
        What are you working on right now? Tap whichever fits — it takes one tap and helps us point you the right way.
      </p>
      ${this.mcqButtons(token, options)}
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:20px 0 0">
        Or just reply to this email and tell us — a real person reads it.
      </p>`;

    return this.sendMail({
      to,
      from: FROM,
      replyTo: FROM,
      subject: 'Quick one — what are you working on?',
      html: this.wrapper(body, userId),
    });
  }

  /** MCQ-friction — "what's getting in the way?" four tap buttons. */
  async sendMcqFrictionEmail(to: string, userId: string, firstName?: string, leadSource?: string | null) {
    const name = this.firstName(firstName);
    const leadLine = this.leadContextLine(leadSource);
    const token = signEngagementToken({ user_id: userId, type: 'mcq_friction' });

    const options: Array<[string, string]> = [
      ['⏳ Too busy right now', 'too_busy'],
      ["🤔 Not sure it's right for me", 'not_sure'],
      ['💷 Worried about price', 'price'],
      ['👀 Just browsing for now', 'browsing'],
    ];

    const body = `
      <h1 style="color:#fff;font-size:24px;font-weight:800;margin:0 0 12px;line-height:1.3">${name}, what's getting in the way?</h1>
      ${leadLine}
      <p style="color:#e5e5e5;font-size:15px;line-height:1.6;margin:0 0 20px">
        You signed up but haven't finished setting up yet. No worries — what's holding you back? One tap tells us how to help.
      </p>
      ${this.mcqButtons(token, options)}
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:20px 0 0">
        Or just reply — a real person reads every email.
      </p>`;

    return this.sendMail({
      to,
      from: FROM,
      replyTo: FROM,
      subject: "What's getting in the way?",
      html: this.wrapper(body, userId),
    });
  }

  /** Breakup — gentle final touch, no MCQ, single soft CTA. */
  async sendBreakupEmail(to: string, userId: string, firstName?: string, leadSource?: string | null) {
    const name = this.firstName(firstName);
    const frontend = this.frontendBase();
    const leadLine = this.leadContextLine(leadSource);

    const body = `
      <h1 style="color:#fff;font-size:24px;font-weight:800;margin:0 0 12px;line-height:1.3">I'll stop here, ${name}</h1>
      ${leadLine}
      <p style="color:#e5e5e5;font-size:15px;line-height:1.6;margin:0 0 16px">
        I won't keep emailing you — I know inboxes are full enough. But your account is here whenever you're ready, and you can reply to this email any time you want a hand with a subject or exam.
      </p>
      <a href="${frontend}/onboarding" style="display:inline-block;background:#1f1f1f;border:1px solid #333;color:#fff;text-decoration:none;padding:13px 22px;border-radius:50px;font-weight:600;font-size:14px;margin:0 0 8px">
        Finish setting up whenever you like →
      </a>
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:16px 0 0">
        Genuinely — reply if there's anything I can help with. — The StudyHours team
      </p>`;

    return this.sendMail({
      to,
      from: FROM,
      replyTo: FROM,
      subject: "I'll stop here",
      html: this.wrapper(body, userId),
    });
  }

  // ── Builder helpers ──────────────────────────────────────────────────────────

  private firstName(firstName?: string): string {
    return firstName && firstName !== 'New' ? firstName : 'there';
  }

  private frontendBase(): string {
    return (process.env.FRONTEND_URL || 'https://studyhours.com').replace(/\/$/, '');
  }

  private apiBase(): string {
    return (
      process.env.PUBLIC_API_URL ||
      process.env.API_BASE_URL ||
      'https://api.studyhours.com'
    ).replace(/\/$/, '');
  }

  /** Renders the four MCQ tap buttons, each a signed `/r/{token}?a=<key>` link. */
  private mcqButtons(token: string, options: Array<[string, string]>): string {
    const apiBase = this.apiBase();
    return options
      .map(
        ([label, key]) => `
      <a href="${apiBase}/r/${token}?a=${key}" style="display:block;background:#111;border:1px solid #2a2a2a;color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:600;font-size:15px;margin:0 0 10px">
        ${label}
      </a>`,
      )
      .join('');
  }

  /** Branded dark-theme HTML wrapper with StudyHours wordmark + unsubscribe footer. */
  private wrapper(body: string, userId: string): string {
    const apiBase = this.apiBase();
    const unsubToken = signEngagementToken({ user_id: userId, type: 'unsubscribe' });
    const unsubUrl = `${apiBase}/u/${unsubToken}`;

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <tr><td style="padding:0 0 24px">
          <span style="color:#fff;font-size:20px;font-weight:700">StudyHours</span>
        </td></tr>
        <tr><td style="background:#0f0f0f;border:1px solid #1f1f1f;border-radius:16px;padding:36px">
          ${body}
        </td></tr>
        <tr><td style="padding:24px 0 0;color:#444;font-size:12px;text-align:center">
          StudyHours · <a href="https://studyhours.com" style="color:#444">studyhours.com</a>
          · <a href="${unsubUrl}" style="color:#444">Unsubscribe</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private leadContextLine(leadSource?: string | null): string {
    if (!leadSource) return '';
    const map: Record<string, string> = {
      'gcse-paper3-hitlist': 'Great to have you back after the GCSE Maths Paper 3 hit-list.',
      gcse_tracker: 'Great to have you back after the GCSE Paper 3 tracker.',
      sat_quiz: 'Great to have you back after the SAT score quiz.',
      desmos_guide: 'Great to have you back after the Desmos guide.',
      pure1_solutions: 'Great to have you back after the A-Level Pure 1 solutions.',
    };
    const line = map[leadSource];
    if (!line) return '';
    return `<p style="color:#5c9dff;font-size:14px;line-height:1.6;font-weight:600;margin:0 0 16px">${line}</p>`;
  }

  async sendVerificationEmail(to: string, token: string) {
    // Determine Verification URL. If FRONTEND_URL is set (e.g.
    // https://studyhours.com) use it; otherwise default to the prod domain so a
    // missing env never emails a localhost link.
    const baseUrl = process.env.FRONTEND_URL || 'https://studyhours.com';
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
