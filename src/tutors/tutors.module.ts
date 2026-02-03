import { Module } from '@nestjs/common';
import { TutorsService } from './tutors.service';
import { TutorsController } from './tutors.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, BookingsModule, AuthModule], // BookingsModule needed for service? Or import service directly?
  // TutorsController uses BookingsService, so we need BookingsModule to export it.
  controllers: [TutorsController],
  providers: [TutorsService],
  exports: [TutorsService],
})
export class TutorsModule { }
