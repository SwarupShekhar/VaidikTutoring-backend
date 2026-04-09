import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import * as path from 'path';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RawBodyMiddleware } from './common/middleware/raw-body.middleware';

import { AuthModule } from './auth/auth.module.js';
import { StudentsModule } from './students/students.module.js';
import { EnrollmentsModule } from './enrollments/enrollments.module.js';
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
import { BlogsModule } from './blogs/blogs.module.js';
import { ParentModule } from './parent/parent.module';
import { ProgramsModule } from './programs/programs.module';
import { SchoolsModule } from './schools/schools.module';
import { AttentionEventsModule } from './attention-events/attention-events.module';
import { SessionPhasesModule } from './session-phases/session-phases.module';
import { SubjectsModule } from './subjects/subjects.module';
import { PaymentsModule } from './payments/payments.module';
import { CreditsModule } from './credits/credits.module';
import { RatingsModule } from './ratings/ratings.module.js';
import { MediaModule } from './media/media.module';
import { StorageModule } from './storage/storage.module';
import { DailyModule } from './daily/daily.module';
import { PhoneVerificationModule } from './phone-verification/phone-verification.module.js';


@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{
      ttl: 60000, // 1 minute
      limit: 100, // 100 requests per minute
    }]),
    PrismaModule, // <-- VERY IMPORTANT
    AuthModule, // <-- VERY IMPORTANT
    StudentsModule,
    TutorsModule,
    BookingsModule,
    SessionsModule,
    InviteModule,
    TestEmailModule,
    EmailModule,
    CatalogModule,
    ScheduleModule.forRoot(),
    NotificationsModule,
    AdminModule,
    BlogsModule,
    ParentModule,
    ProgramsModule,
    SchoolsModule,
    AttentionEventsModule,
    SessionPhasesModule,
    SubjectsModule,
    PaymentsModule,
    CreditsModule,
    RatingsModule,
    PhoneVerificationModule,
    StorageModule,
    MediaModule,
    DailyModule,
    ServeStaticModule.forRoot({
      rootPath: path.join(process.cwd(), 'public'),
      serveRoot: '/',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RawBodyMiddleware)
      .forRoutes('payments');
  }
}
