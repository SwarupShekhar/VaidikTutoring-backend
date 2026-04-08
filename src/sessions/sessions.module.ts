import { Module, forwardRef } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { AuthModule } from '../auth/auth.module';
import { SessionsService } from './sessions.service';
import { SessionsGateway } from './sessions.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AttentionEventsModule } from '../attention-events/attention-events.module.js';
import { SessionPhasesModule } from '../session-phases/session-phases.module.js';
import { DailyModule } from '../daily/daily.module.js';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';

import { AzureModule } from '../azure/azure.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    AttentionEventsModule,
    SessionPhasesModule,
    AzureModule,
    AuthModule,
    NotificationsModule,
    forwardRef(() => DailyModule),
    forwardRef(() => StudentsModule),
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsGateway],
  exports: [SessionsService, SessionsGateway],
})
export class SessionsModule { }
