import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionsController, LegacySessionController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsGateway } from './sessions.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { JitsiTokenService } from '../common/services/jitsi-token.service';
import { DailyService } from '../daily/daily.service';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'secret' }),
  ],
  controllers: [SessionsController, LegacySessionController],
  providers: [SessionsService, SessionsGateway, JitsiTokenService, DailyService],
  exports: [SessionsService],
})
export class SessionsModule { }
