import { Module } from '@nestjs/common';
import { ParentController } from './parent.controller';
import { ParentService } from './parent.service';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RatingsModule } from '../ratings/ratings.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [AuthModule, StudentsModule, BookingsModule, RatingsModule, CreditsModule],
  controllers: [ParentController],
  providers: [ParentService]
})
export class ParentModule { }
