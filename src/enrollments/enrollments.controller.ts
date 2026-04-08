import { Controller, Post, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service.js';
import { CreateEnrollmentDto } from './create-enrollment.dto.js';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorators.js';
import { ParentOwnsStudentGuard } from '../auth/parent-owns-student.guard.js';

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post()
  @UseGuards(ClerkAuthGuard, RolesGuard, ParentOwnsStudentGuard)
  @Roles('parent', 'student')
  async create(@Body() createEnrollmentDto: CreateEnrollmentDto) {
    return this.enrollmentsService.createEnrollment(createEnrollmentDto);
  }

  @Get('tutor-recommendations/:studentId')
  @UseGuards(ClerkAuthGuard, RolesGuard, ParentOwnsStudentGuard)
  @Roles('parent', 'student')
  async getRecommendations(@Param('studentId') studentId: string) {
    return this.enrollmentsService.getTutorRecommendations(studentId);
  }
}
