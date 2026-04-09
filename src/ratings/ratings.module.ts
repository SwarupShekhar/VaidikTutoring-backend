import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [RatingsController],
  providers: [RatingsService, JwtAuthGuard],
  exports: [RatingsService],
})
export class RatingsModule {}
