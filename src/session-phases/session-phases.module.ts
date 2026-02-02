import { Module } from '@nestjs/common';
import { SessionPhasesService } from './session-phases.service.js';
import { SessionPhasesController } from './session-phases.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
    imports: [PrismaModule],
    controllers: [SessionPhasesController],
    providers: [SessionPhasesService],
    exports: [SessionPhasesService],
})
export class SessionPhasesModule { }
