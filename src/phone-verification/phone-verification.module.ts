import { Module } from '@nestjs/common';
import { PhoneVerificationController } from './phone-verification.controller';
import { PhoneVerificationService } from './phone-verification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PhoneVerificationController],
  providers: [PhoneVerificationService],
})
export class PhoneVerificationModule {}
