import { Module } from '@nestjs/common';
import { ZoomService } from './zoom.service';
import { ZoomWebhookController } from './zoom-webhook.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ZoomWebhookController],
  providers: [ZoomService],
  exports: [ZoomService],
})
export class ZoomModule {}
