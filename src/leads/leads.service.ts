import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

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
}
