import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { AdminTutorsController } from './admin-tutors.controller.js';
import { AdminTutorsService } from './admin-tutors.service.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [
    PassportModule,
    EmailModule,
    JwtModule.register({
      secret: 'SECRET_KEY', // move to env later
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController, AdminTutorsController],
  providers: [AuthService, PrismaService, JwtStrategy, AdminTutorsService],
})
export class AuthModule { }
