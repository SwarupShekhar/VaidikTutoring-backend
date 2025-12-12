import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { EmailModule } from '../email/email.module.js';
import { PrismaModule } from '../prisma/prisma.module.js'; // Assuming PrismaModule import is needed

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '1d' },
    }),
    EmailModule
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule { }
