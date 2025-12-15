import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsGateway } from './sessions.gateway';
import { PrismaModule } from 'src/prisma/prisma.module';
import { EmailModule } from 'src/email/email.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'secret' })
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsGateway],
  exports: [SessionsService],
})
export class SessionsModule { }