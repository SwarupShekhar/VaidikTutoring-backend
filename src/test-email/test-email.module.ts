import { Module } from '@nestjs/common';
import { TestEmailController } from './test-email.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TestEmailController],
})
export class TestEmailModule {}
