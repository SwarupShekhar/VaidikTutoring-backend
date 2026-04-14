import { Module } from '@nestjs/common';
import { SessionPhasesService } from './session-phases.service';
import { SessionPhasesController } from './session-phases.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [SessionPhasesController],
    providers: [SessionPhasesService],
    exports: [SessionPhasesService],
})
export class SessionPhasesModule { }
