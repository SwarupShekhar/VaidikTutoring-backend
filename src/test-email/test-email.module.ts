import { Module } from '@nestjs/common';
import { TestEmailController } from './test-email.controller.js';

@Module({
  controllers: [TestEmailController],
})
export class TestEmailModule {}
