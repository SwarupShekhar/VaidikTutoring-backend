import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { AuthModule } from '../auth/auth.module';
import { SessionsService } from './sessions.service';
import { SessionsGateway } from './sessions.gateway';
import { WhiteboardGateway } from './whiteboard.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AttentionEventsModule } from '../attention-events/attention-events.module.js';
import { DailyService } from '../daily/daily.service.js';
import { SessionPhasesModule } from '../session-phases/session-phases.module.js';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    AttentionEventsModule,
    SessionPhasesModule,
    AuthModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsGateway, DailyService, WhiteboardGateway],
  exports: [SessionsService, SessionsGateway, WhiteboardGateway],
})
export class SessionsModule { }
