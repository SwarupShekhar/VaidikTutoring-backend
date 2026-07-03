import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssignmentsService } from './assignments.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';

@Controller('assignments')
@UseGuards(ClerkAuthGuard, RolesGuard)
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Post()
  @Roles('admin', 'tutor')
  async createAssignment(@Body() body: any, @Request() req: any) {
    const tutorId = req.user?.userId; // Adjust based on your Auth context
    return this.assignmentsService.createAssignment(body, tutorId);
  }

  @Get()
  async getAssignments(
    @Query('curriculum_id') curriculumId: string,
    @Query('grade') grade: string,
    @Query('user_id') userId: string,
  ) {
    return this.assignmentsService.getAssignments(curriculumId, grade, userId);
  }

  @Post(':id/submit')
  @Roles('student')
  @UseInterceptors(FileInterceptor('file'))
  async submitAssignment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any
  ) {
    const userId = req.user?.userId;
    return this.assignmentsService.submitAssignmentWithFile(id, userId, file);
  }

  @Patch('submissions/:id/grade')
  @Roles('admin', 'tutor')
  async gradeAssignment(
    @Param('id') submissionId: string,
    @Body() body: { score: number; feedback: string },
    @Request() req: any
  ) {
    return this.assignmentsService.gradeAssignment(submissionId, body.score, body.feedback, req.user?.userId);
  }
}
