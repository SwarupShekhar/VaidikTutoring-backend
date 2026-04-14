import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('ratings')
@UseGuards(JwtAuthGuard)
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Get('pending')
  async getPending(@Req() req: any) {
    const { userId, role } = req.user;
    return this.ratingsService.getPendingRatings(userId, role);
  }

  @Post('sessions/:sessionId')
  @HttpCode(HttpStatus.CREATED)
  async submitRating(
    @Param('sessionId') sessionId: string,
    @Req() req: any,
    @Body() dto: CreateRatingDto,
  ) {
    const { userId } = req.user;
    return this.ratingsService.submitRating(sessionId, userId, dto);
  }
}
