import { Module } from '@nestjs/common';
import { SessionPhasesService } from './session-phases.service.js';
import { SessionPhasesController } from './session-phases.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [SessionPhasesController],
    providers: [SessionPhasesService],
    exports: [SessionPhasesService],
})
export class SessionPhasesModule { }
