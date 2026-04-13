import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly adminEmail = process.env.ADMIN_SUPPORT_EMAIL || 'swarupshekhar.vaidikedu@gmail.com';

  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) { }

  async submitRequest(userId: string, message: string, context?: any) {
    this.logger.log(`Support request from user ${userId}`);

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { first_name: true, last_name: true, email: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User';

    // 1. Persist ticket to DB
    const ticket = await this.prisma.support_tickets.create({
      data: { user_id: userId, message, context: context || {} },
    });

    // 2. Notify all admins (real-time WebSocket + bell + email)
    await this.notificationsService.notifyAdminSupport(ticket.id, userName, message);

    await this.emailService.sendMail({
      to: this.adminEmail,
      subject: `[Support #${ticket.id.slice(0, 8)}] ${user.role.toUpperCase()}: ${userName}`,
      html: `
        <h2>New Support Request</h2>
        <p><strong>From:</strong> ${userName} (${user.email})</p>
        <p><strong>Role:</strong> ${user.role}</p>
        <p><strong>Ticket ID:</strong> ${ticket.id}</p>
        <hr />
        <p><strong>Message:</strong></p>
        <blockquote style="background:#f4f4f4;padding:15px;border-left:5px solid #6366f1;">
          ${message}
        </blockquote>
        <p><strong>Context:</strong></p>
        <pre style="background:#f4f4f4;padding:10px;">${JSON.stringify(context || {}, null, 2)}</pre>
        <p><a href="${process.env.FRONTEND_URL}/admin/dashboard?tab=support">View in Admin Dashboard →</a></p>
      `,
      text: `Support request from ${userName} (${user.email})\n\n${message}`,
    });

    // 3. Auto-response to student
    await this.emailService.sendMail({
      to: user.email,
      subject: 'We received your help request',
      text: `Hi ${user.first_name || 'there'},\n\nWe received your help request and will get back to you soon.\n\nYour message:\n${message}`,
    });

    return { success: true, ticketId: ticket.id };
  }

  // ── ADMIN ENDPOINTS ───────────────────────────────────────────────

  async getTickets(status?: string) {
    return this.prisma.support_tickets.findMany({
      where: status ? { status } : undefined,
      include: {
        users: {
          select: { first_name: true, last_name: true, email: true, role: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async updateTicket(ticketId: string, status: string, adminNote?: string) {
    const ticket = await this.prisma.support_tickets.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    return this.prisma.support_tickets.update({
      where: { id: ticketId },
      data: {
        status,
        ...(adminNote !== undefined && { admin_note: adminNote }),
      },
      include: {
        users: { select: { first_name: true, last_name: true, email: true, role: true } },
      },
    });
  }
}
