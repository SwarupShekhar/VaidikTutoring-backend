import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
    imports: [EmailModule, PrismaModule],
    controllers: [NotificationsController],
    providers: [RemindersService, NotificationsService],
    exports: [RemindersService, NotificationsService],
})
export class NotificationsModule { }
