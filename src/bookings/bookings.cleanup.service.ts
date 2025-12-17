import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BookingsCleanupService {
    private readonly logger = new Logger(BookingsCleanupService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Automatically archive bookings that are past their end time.
     * Runs every hour.
     */
    @Cron(CronExpression.EVERY_HOUR)
    async archivePastBookings() {
        this.logger.log('Running scheduled job: archivePastBookings...');

        const now = new Date();

        try {
            const result = await this.prisma.bookings.updateMany({
                where: {
                    requested_end: {
                        lt: now,
                    },
                    status: {
                        notIn: ['archived', 'cancelled'], // Don't touch already final statuses if needed, but 'archived' is our target
                    },
                },
                data: {
                    status: 'archived',
                },
            });

            if (result.count > 0) {
                this.logger.log(`Archived ${result.count} past bookings.`);
            } else {
                this.logger.log('No past bookings found to archive.');
            }
        } catch (error) {
            this.logger.error('Failed to run archivePastBookings job', error);
        }
    }
}
