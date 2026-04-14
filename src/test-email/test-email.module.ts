import { Module } from '@nestjs/common';
import { TestEmailController } from './test-email.controller';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TestEmailController],
})
export class TestEmailModule {}
