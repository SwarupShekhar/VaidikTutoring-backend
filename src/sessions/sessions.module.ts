import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsGateway } from './sessions.gateway';
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
    JwtModule.register({ secret: process.env.JWT_SECRET || 'secret' }),
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsGateway, DailyService],
  exports: [SessionsService],
})
export class SessionsModule { }
