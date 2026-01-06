import { Module } from '@nestjs/common';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProgramsModule } from '../programs/programs.module';

@Module({
    imports: [PrismaModule, ProgramsModule],
    controllers: [SchoolsController],
    providers: [SchoolsService],
    exports: [SchoolsService]
})
export class SchoolsModule { }
