import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller.js';
import { RatingsService } from './ratings.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [RatingsController],
  providers: [RatingsService, JwtAuthGuard],
  exports: [RatingsService],
})
export class RatingsModule {}
