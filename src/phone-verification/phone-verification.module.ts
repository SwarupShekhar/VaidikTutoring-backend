import { Module } from '@nestjs/common';
import { PhoneVerificationController } from './phone-verification.controller.js';
import { PhoneVerificationService } from './phone-verification.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PhoneVerificationController],
  providers: [PhoneVerificationService],
})
export class PhoneVerificationModule {}
