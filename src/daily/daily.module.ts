import { Module } from '@nestjs/common';
import { DailyService } from './daily.service';
import { DailyWebhookController } from './daily-webhook.controller';
import { AzureModule } from '../azure/azure.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AzureModule, PrismaModule],
  controllers: [DailyWebhookController],
  providers: [DailyService],
  exports: [DailyService],
})
export class DailyModule {}
