import { Module } from '@nestjs/common';
import { TutorsService } from './tutors.service';
import { TutorsController } from './tutors.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AuthModule } from '../auth/auth.module';
import { TutorStatusGuard } from '../auth/tutor-status.guard';

@Module({
  imports: [PrismaModule, BookingsModule, AuthModule],
  controllers: [TutorsController],
  providers: [TutorsService, TutorStatusGuard],
  exports: [TutorsService],
})
export class TutorsModule { }
