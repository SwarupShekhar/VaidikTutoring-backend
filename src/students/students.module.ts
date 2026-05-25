import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CreditsModule } from '../credits/credits.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RatingsModule } from '../ratings/ratings.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CreditsModule,
    BookingsModule,
    RatingsModule,
  ],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule { }
