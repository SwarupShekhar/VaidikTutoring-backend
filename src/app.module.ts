import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { AuthModule } from './auth/auth.module.js';
import { StudentsModule } from './students/students.module.js';
import { TutorsModule } from './tutors/tutors.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { InviteModule } from './invite/invite.module.js';
import { TestEmailModule } from './test-email/test-email.module.js';
import { EmailModule } from './email/email.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AdminModule } from './admin/admin.module.js';

@Module({
  imports: [
    PrismaModule, // <-- VERY IMPORTANT
    AuthModule, // <-- VERY IMPORTANT
    StudentsModule,
    TutorsModule,
    BookingsModule,
    SessionsModule,
    InviteModule,
    TestEmailModule,
    EmailModule,
    EmailModule,
    CatalogModule,
    ScheduleModule.forRoot(),
    NotificationsModule,
    AdminModule,


  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
