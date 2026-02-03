import { Module } from '@nestjs/common';
import { AttentionEventsService } from './attention-events.service.js';
import { AttentionEventsController } from './attention-events.controller.js';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module.js';

@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [AttentionEventsController],
    providers: [AttentionEventsService],
    exports: [AttentionEventsService],
})
export class AttentionEventsModule { }
