import { Module, forwardRef } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { AuthModule } from '../auth/auth.module';
import { SessionsService } from './sessions.service';
import { SessionsGateway } from './sessions.gateway';
import { SessionsCronService } from './sessions-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AttentionEventsModule } from '../attention-events/attention-events.module';
import { SessionPhasesModule } from '../session-phases/session-phases.module';
import { DailyModule } from '../daily/daily.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { AzureModule } from '../azure/azure.module';
import { CreditsModule } from '../credits/credits.module';
import { TutorStatusGuard } from '../auth/tutor-status.guard';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    AttentionEventsModule,
    SessionPhasesModule,
    AzureModule,
    AuthModule,
    NotificationsModule,
    CreditsModule,
    forwardRef(() => DailyModule),
    forwardRef(() => StudentsModule),
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsGateway, SessionsCronService, TutorStatusGuard],
  exports: [SessionsService, SessionsGateway],
})
export class SessionsModule { }
