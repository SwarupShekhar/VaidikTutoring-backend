import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly adminEmail = process.env.ADMIN_SUPPORT_EMAIL || 'support@vaidiktutoring.com';

  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  async submitRequest(userId: string, message: string, context?: any) {
    this.logger.log(`Support request from user ${userId}: ${message}`);

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { first_name: true, last_name: true, email: true, role: true },
    });

    if (!user) throw new Error('User not found');

    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User';

    // 1. Send email to admin
    await this.emailService.sendMail({
      to: this.adminEmail,
      subject: `[Support Request] ${user.role.toUpperCase()}: ${userName}`,
      text: `
        Support Request from ${userName} (${user.email})
        Role: ${user.role}
        User ID: ${userId}
        
        Message:
        ${message}
        
        Context (Session/Booking):
        ${JSON.stringify(context || {}, null, 2)}
      `,
      html: `
        <h2>New Support Request</h2>
        <p><strong>From:</strong> ${userName} (${user.email})</p>
        <p><strong>Role:</strong> ${user.role}</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <hr />
        <p><strong>Message:</strong></p>
        <blockquote style="background: #f4f4f4; padding: 15px; border-left: 5px solid #ccc;">
          ${message}
        </blockquote>
        <p><strong>Context Metadata:</strong></p>
        <pre style="background: #f4f4f4; padding: 10px;">${JSON.stringify(context || {}, null, 2)}</pre>
      `,
    });

    // 2. Clear auto-response to user
    await this.emailService.sendMail({
      to: user.email,
      subject: 'We received your help request',
      text: `Hi ${user.first_name || 'there'},\n\nWe received your help request and will get back to you soon.\n\nYour message:\n${message}`,
    });

    return { success: true };
  }
}
