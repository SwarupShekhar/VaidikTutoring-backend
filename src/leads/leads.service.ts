import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async capture(emailAddr: string, source: string) {
    const lead = await this.prisma.leadCapture.create({
      data: { email: emailAddr, source },
    });

    this.logger.log(`Lead captured: ${emailAddr} from ${source}`);

    const adminEmail = process.env.ADMIN_EMAIL || 'swarupshekhar.vaidikedu@gmail.com';
    await this.email.sendMail({
      to: adminEmail,
      subject: `New lead: ${source}`,
      html: `<p>Email: <strong>${emailAddr}</strong><br>Source: ${source}<br>Time: ${new Date().toUTCString()}</p>`,
    });

    return { success: true, id: lead.id };
  }

  async captureTestPrep(data: { name: string; email: string; phone: string; target_test: string }) {
    const lead = await this.prisma.test_prep_leads.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        target_test: data.target_test,
        status: 'NEW'
      },
    });

    this.logger.log(`Test Prep Lead captured: ${data.email} for ${data.target_test}`);

    const adminEmail = process.env.ADMIN_EMAIL || 'swarupshekhar.vaidikedu@gmail.com';
    await this.email.sendMail({
      to: adminEmail,
      subject: `New Test Prep Lead: ${data.target_test}`,
      html: `<p>Name: <strong>${data.name}</strong><br>Email: <strong>${data.email}</strong><br>Phone: <strong>${data.phone}</strong><br>Test: ${data.target_test}<br>Time: ${new Date().toUTCString()}</p>`,
    });

    return { success: true, id: lead.id };
  }

  /**
   * Blast GCSE leads with the Paper 3 Solutions PDF + quiz funnel link.
   * Excludes emails already in the users table (already signed up).
   * Returns { queued: number, skipped: number, total: number }.
   */
  async blastGcseLeads(dryRun = false, testEmail?: string) {
    let targetLeads: Array<{ email: string; source: string }> = [];
    let skipped = 0;
    let totalCount = 0;

    if (testEmail) {
      targetLeads = [{ email: testEmail.trim().toLowerCase(), source: 'gcse-test-run' }];
      totalCount = 1;
      skipped = 0;
    } else {
      // 1. Find all GCSE leads
      const allLeads = await this.prisma.leadCapture.findMany({
        where: {
          source: { contains: 'gcse', mode: 'insensitive' },
        },
        select: { email: true, source: true },
      });

      // Deduplicate by email (keep first occurrence)
      const uniqueLeads = new Map<string, string>();
      for (const lead of allLeads) {
        const normalized = lead.email.toLowerCase().trim();
        if (!uniqueLeads.has(normalized)) {
          uniqueLeads.set(normalized, lead.source);
        }
      }

      // 2. Find emails already signed up
      const existingUsers = await this.prisma.users.findMany({
        where: {
          email: { in: Array.from(uniqueLeads.keys()) },
        },
        select: { email: true },
      });
      const signedUpEmails = new Set(existingUsers.map((u) => u.email?.toLowerCase()));

      // 3. Filter to leads NOT signed up
      for (const [email, source] of uniqueLeads) {
        if (!signedUpEmails.has(email)) {
          targetLeads.push({ email, source });
        }
      }

      skipped = uniqueLeads.size - targetLeads.length;
      totalCount = uniqueLeads.size;
    }

    if (dryRun) {
      return {
        dryRun: true,
        total: totalCount,
        alreadySignedUp: skipped,
        wouldSend: targetLeads.length,
        emails: targetLeads.map((l) => l.email),
      };
    }

    // 4. Read the PDF
    const pdfPath = path.resolve(
      process.cwd(),
      'private-assets/GCSE_Paper3_Complete_Solutions_StudyHours.pdf',
    );
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = fs.readFileSync(pdfPath);
      this.logger.log(`PDF loaded: ${pdfPath} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
    } catch {
      this.logger.warn(`PDF not found at ${pdfPath} — sending without attachment`);
    }

    // 5. Send emails
    const frontend = (process.env.FRONTEND_URL || 'https://studyhours.com').replace(/\/$/, '');
    let queued = 0;

    for (const lead of targetLeads) {
      const quizLink = `${frontend}/gcse-results?utm_source=gcse_blast&utm_medium=email&utm_campaign=gcse_2026&email=${encodeURIComponent(lead.email)}`;

      const html = this.buildGcseBlastHtml(lead.email, quizLink);

      const attachments = pdfBuffer
        ? [
            {
              filename: 'GCSE_Paper3_Complete_Solutions_StudyHours.pdf',
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ]
        : [];

      await this.email.sendMail({
        to: lead.email,
        from: 'StudyHours <hellostudents@studyhours.com>',
        replyTo: 'StudyHours <hellostudents@studyhours.com>',
        subject: 'Your GCSE Paper 3 Complete Solutions — attached 📎',
        html,
        attachments,
      });

      queued++;
    }

    this.logger.log(`GCSE blast complete: ${queued} queued, ${skipped} skipped (already signed up)`);

    return { queued, skipped, total: totalCount };
  }

  private buildGcseBlastHtml(email: string, quizLink: string): string {
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

          <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 16px;line-height:1.2">
            Your GCSE Paper 3 Solutions are here 📎
          </h1>

          <p style="color:#e5e5e5;font-size:15px;line-height:1.7;margin:0 0 16px">
            The exam hall stress is over. We've compiled the <strong style="color:#fff">Complete Solutions for GCSE Maths Paper 3</strong> — they're attached to this email so you can finally stop guessing how Question 7 was supposed to work.
          </p>

          <p style="color:#e5e5e5;font-size:15px;line-height:1.7;margin:0 0 20px">
            But marking your answers is only half the picture.
          </p>

          <p style="color:#5c9dff;font-size:14px;font-weight:700;margin:0 0 4px">
            The students who improve fastest don't just check answers —
          </p>
          <p style="color:#5c9dff;font-size:14px;font-weight:700;margin:0 0 20px">
            they find the pattern in what they got wrong.
          </p>

          <p style="color:#e5e5e5;font-size:15px;line-height:1.7;margin:0 0 20px">
            We built a free <strong style="color:#fff">Post-Exam Results Analyser</strong> that predicts your grade based on your exam board, tier, and the topics you struggled with. Takes 30 seconds:
          </p>

          <a href="${quizLink}" style="display:inline-block;background:#4c70f5;color:#fff;text-decoration:none;padding:16px 28px;border-radius:50px;font-weight:700;font-size:15px;margin:0 0 20px">
            Check Your Predicted Grade →
          </a>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0">
            <tr>
              <td style="padding:12px 0;border-top:1px solid #1f1f1f">
                <span style="color:#22c55e;font-size:14px;margin-right:8px">✅</span>
                <span style="color:#ccc;font-size:14px">See your estimated grade band instantly</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-top:1px solid #1f1f1f">
                <span style="color:#22c55e;font-size:14px;margin-right:8px">✅</span>
                <span style="color:#ccc;font-size:14px">Find which topics cost you the most marks</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-top:1px solid #1f1f1f">
                <span style="color:#22c55e;font-size:14px;margin-right:8px">✅</span>
                <span style="color:#ccc;font-size:14px">Get matched with a tutor for your exact weak spots</span>
              </td>
            </tr>
          </table>

          <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:20px 0 0">
            Or just reply to this email — a real person reads every one.
          </p>

        </td></tr>
        <tr><td style="padding:24px 0 0;color:#444;font-size:12px;text-align:center">
          StudyHours · <a href="https://studyhours.com" style="color:#444">studyhours.com</a>
          · <a href="mailto:hellostudents@studyhours.com" style="color:#444">Unsubscribe</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}

