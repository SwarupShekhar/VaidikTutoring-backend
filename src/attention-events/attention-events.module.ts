import { Module } from '@nestjs/common';
import { AttentionEventsService } from './attention-events.service';
import { AttentionEventsController } from './attention-events.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [AttentionEventsController],
    providers: [AttentionEventsService],
    exports: [AttentionEventsService],
})
export class AttentionEventsModule { }
