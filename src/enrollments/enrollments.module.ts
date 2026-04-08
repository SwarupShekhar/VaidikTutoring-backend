import { Module } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service.js';
import { EnrollmentsController } from './enrollments.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BookingsModule } from '../bookings/bookings.module.js';

@Module({
  imports: [PrismaModule, BookingsModule],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
