import { Module } from '@nestjs/common';
import { AttentionEventsService } from './attention-events.service.js';
import { AttentionEventsController } from './attention-events.controller.js';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AttentionEventsController],
    providers: [AttentionEventsService],
    exports: [AttentionEventsService],
})
export class AttentionEventsModule { }
