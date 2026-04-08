import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { EmailModule } from '../email/email.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { CreditsModule } from '../credits/credits.module.js';
import { JwtStrategy } from './jwt.strategy.js';
import { ClerkAuthGuard } from './clerk-auth.guard.js';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata.js';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '1d' },
    }),
    EmailModule,
    AdminModule,
    CreditsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ClerkAuthGuard, SyncClerkMetadataService],
  exports: [AuthService, JwtModule, ClerkAuthGuard, SyncClerkMetadataService],
})
export class AuthModule { }
