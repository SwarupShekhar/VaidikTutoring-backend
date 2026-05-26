import { Module } from '@nestjs/common';
import { ParentController } from './parent.controller';
import { ParentService } from './parent.service';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { BookingsModule } from '../bookings/bookings.module';
import { RatingsModule } from '../ratings/ratings.module';

@Module({
  imports: [AuthModule, StudentsModule, BookingsModule, RatingsModule],
  controllers: [ParentController],
  providers: [ParentService]
})
export class ParentModule { }
