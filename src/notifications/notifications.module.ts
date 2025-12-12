import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [EmailModule, PrismaModule],
    providers: [RemindersService],
    exports: [RemindersService],
})
export class NotificationsModule { }
