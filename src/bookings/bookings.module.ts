import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { BookingsController } from './bookings.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EmailModule } from '../email/email.module.js';

import { NotificationsModule } from '../notifications/notifications.module';

import { BookingsCleanupService } from './bookings.cleanup.service.js';

@Module({
  imports: [PrismaModule, EmailModule, NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsCleanupService],
  exports: [BookingsService],
})
export class BookingsModule { }
