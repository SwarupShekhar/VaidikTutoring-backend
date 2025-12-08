import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TutorsController } from './tutors.controller';
import { TutorsService } from './tutors.service';

@Module({
  controllers: [TutorsController],
  providers: [TutorsService, PrismaService]
})
export class TutorsModule { }
