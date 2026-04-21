import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { CreditsModule } from '../credits/credits.module';

import { NotificationsModule } from '../notifications/notifications.module';
import { AzureModule } from '../azure/azure.module';

import { BookingsCleanupService } from './bookings.cleanup.service';
import { BookingFallbackSchedulerService } from './booking-fallback-scheduler.service';
import { BookingAlertsService } from './booking-alerts.service';
import { TutorStatusGuard } from '../auth/tutor-status.guard';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    NotificationsModule,
    AuthModule,
    CreditsModule,
    AzureModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsCleanupService, BookingFallbackSchedulerService, BookingAlertsService, TutorStatusGuard],
  exports: [BookingsService],
})
export class BookingsModule { }
