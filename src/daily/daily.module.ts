import { Module } from '@nestjs/common';
import { DailyService } from './daily.service';
import { DailyWebhookController } from './daily-webhook.controller';
import { AzureModule } from '../azure/azure.module';
import { PrismaModule } from '../prisma/prisma.module';
import { forwardRef } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [AzureModule, PrismaModule, forwardRef(() => SessionsModule)],
  controllers: [DailyWebhookController],
  providers: [DailyService],
  exports: [DailyService],
})
export class DailyModule {}
