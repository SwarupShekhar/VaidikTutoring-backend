import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import * as path from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RawBodyMiddleware } from './common/middleware/raw-body.middleware';

import { AuthModule } from './auth/auth.module';
import { StudentsModule } from './students/students.module';
import { TutorsModule } from './tutors/tutors.module';
import { BookingsModule } from './bookings/bookings.module';
import { SessionsModule } from './sessions/sessions.module';
import { PrismaModule } from './prisma/prisma.module';
import { InviteModule } from './invite/invite.module';
import { TestEmailModule } from './test-email/test-email.module';
import { EmailModule } from './email/email.module';
import { CatalogModule } from './catalog/catalog.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { BlogsModule } from './blogs/blogs.module';
import { ParentModule } from './parent/parent.module';
import { ProgramsModule } from './programs/programs.module';
import { SchoolsModule } from './schools/schools.module';
import { AttentionEventsModule } from './attention-events/attention-events.module';
import { SessionPhasesModule } from './session-phases/session-phases.module';
import { SubjectsModule } from './subjects/subjects.module';
import { PaymentsModule } from './payments/payments.module';
import { CreditsModule } from './credits/credits.module';
import { RatingsModule } from './ratings/ratings.module';
import { MediaModule } from './media/media.module';
import { StorageModule } from './storage/storage.module';
import { DailyModule } from './daily/daily.module';
import { PhoneVerificationModule } from './phone-verification/phone-verification.module';
import { SupportModule } from './support/support.module';
import { BackupModule } from './backup/backup.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        try {
          return {
            store: await redisStore({
              url: process.env.REDIS_URL,
              ttl: 60 * 60 * 1000, // 1 hour default
            }),
          };
        } catch (err) {
          console.error('Redis connection failed, falling back to in-memory cache:', err);
          return { ttl: 60 * 60 * 1000 }; // Falls back to local memoryStore
        }
      },
    }),
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
    SupportModule,
    BackupModule,
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
