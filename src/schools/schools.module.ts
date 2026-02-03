import { Module } from '@nestjs/common';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProgramsModule } from '../programs/programs.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [PrismaModule, ProgramsModule, AuthModule],
    controllers: [SchoolsController],
    providers: [SchoolsService],
    exports: [SchoolsService]
})
export class SchoolsModule { }
