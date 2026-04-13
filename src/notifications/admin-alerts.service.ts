import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { subDays, subHours } from 'date-fns';

@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Monitor Tutor Inactivity
   * Runs daily at 2 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async checkTutorInactivity() {
    this.logger.log('Running tutor inactivity check...');
    const sevenDaysAgo = subDays(new Date(), 7);

    // Find tutors who joined over 7 days ago but might need attention
    // FIXME: Add 'last_login' field to users table to track true inactivity
    const inactiveTutors = await this.prisma.users.findMany({
      where: {
        role: 'tutor',
        is_active: true,
        created_at: { lt: sevenDaysAgo }
      },
      select: { 
        id: true, 
        first_name: true, 
        last_name: true, 
        created_at: true 
      }
    });

    for (const tutor of inactiveTutors) {
      const tutorName = `${tutor.first_name || ''} ${tutor.last_name || ''}`.trim() || 'Unnamed Tutor';
      await this.notifications.notifyAdmins('tutor_inactivity', {
        message: `System Alert: Tutor ${tutorName} joined on ${tutor.created_at?.toDateString()}. Please verify their recent activity.`,
        tutorId: tutor.id,
        tutorName: tutorName,
        severity: 'warning'
      });
    }

    if (inactiveTutors.length > 0) {
      this.logger.log(`Alerted for ${inactiveTutors.length} inactive tutors.`);
    }
  }

  /**
   * Monitor Stale Content (Escalation)
   * Runs every 6 hours
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async checkStaleBlogs() {
    this.logger.log('Running stale blog check...');
    const fortyEightHoursAgo = subHours(new Date(), 48);

    const staleBlogs = await this.prisma.blogs.findMany({
      where: {
        status: 'PENDING',
        created_at: { lt: fortyEightHoursAgo }
      },
      select: { id: true, title: true, created_at: true }
    });

    for (const blog of staleBlogs) {
      await this.notifications.notifyAdmins('content_escalation', {
        message: `Escalation: Blog "${blog.title}" has been pending for over 48 hours.`,
        blogId: blog.id,
        severity: 'urgent'
      });
    }

    if (staleBlogs.length > 0) {
      this.logger.log(`Escalated ${staleBlogs.length} stale blogs.`);
    }
  }

  /**
   * Monitor Payment Table for failures (Manual trigger or webhook fallback)
   */
  async notifyPaymentFailure(orderId: string, email: string, amount: number, reason: string) {
    await this.notifications.notifyAdmins('payment_failed', {
      message: `Payment Failure: Order ${orderId} (${email}) for ₹${amount/100} failed. Reason: ${reason}`,
      orderId,
      severity: 'critical',
      link: '/admin/dashboard?tab=payments'
    });
  }
}
