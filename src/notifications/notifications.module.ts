import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [EmailModule, PrismaModule, AuthModule],
  controllers: [NotificationsController],
  providers: [RemindersService, NotificationsService, NotificationsGateway],
  exports: [RemindersService, NotificationsService, NotificationsGateway],
})
export class NotificationsModule { }
