import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { BookingsController } from './bookings.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EmailModule } from '../email/email.module.js';

import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, EmailModule, NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
