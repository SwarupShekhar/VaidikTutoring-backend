import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  Get,
  Delete,
  Param,
  Patch,
  NotFoundException,
} from '@nestjs/common';
import { StudentsService } from './students.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreditsService } from '../credits/credits.service';

// Assuming you have an AuthGuard or similar to get the user
// If not, you might need to extract userId differently.
// Standard pattern: @UseGuards(JwtAuthGuard)
@Controller('students')
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly creditsService: CreditsService,
  ) { }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: any, @Req() req: any) {
    // Ideally use a DTO class for body
    // req.user is populated by JwtStrategy, which returns { userId, email, role }
    const parentUserId = req.user?.userId;

    if (!parentUserId) {
      throw new Error('User not authenticated');
    }

    return this.studentsService.create(body, parentUserId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyProfile(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    const student = await this.studentsService.findByUserId(userId);
    
    // Enrich with credit status
    if (student) {
      const creditStatus = await this.creditsService.getCreditStatus(student);
      return { ...student, creditStatus };
    }
    return student;
  }

  @Get('me/progress-summary')
  @UseGuards(JwtAuthGuard)
  async getMyProgressSummary(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    const student = await this.studentsService.findByUserId(userId);
    if (!student) throw new NotFoundException('Student profile not found');
    return this.studentsService.getProgressSummary(student.id);
  }

  @Get('parent')
  @UseGuards(JwtAuthGuard)
  async findAllByParent(@Req() req: any) {
    const parentUserId = req.user?.userId;
    if (!parentUserId) throw new Error('User not authenticated');

    // transform result if necessary to match frontend expectations
    const students = await this.studentsService.findAllByParent(parentUserId);

    // Map to simple structure if needed
    return students.map((s) => ({
      id: s.id,
      grade: s.grade,
      school: s.school,
      name: `${s.first_name} ${s.last_name || ''}`.trim() || 'Unnamed Student',
      // Return raw fields too if frontend expects them
      first_name: s.first_name,
      last_name: s.last_name,
    }));
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getById(@Param('id') id: string) {
    const student = await this.studentsService.findUniqueById(id);
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  @Get(':id/enrollment-status')
  @UseGuards(JwtAuthGuard)
  async getEnrollmentStatus(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.getEnrollmentStatus(id);
  }

  @Get(':id/progress-summary')
  @UseGuards(JwtAuthGuard)
  async getProgressSummary(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.getProgressSummary(id);
  }

  @Post(':id/update-streak')
  @UseGuards(JwtAuthGuard)
  async updateStreak(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.updateStreak(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') id: string, @Req() req: any) {
    const parentUserId = req.user?.userId;
    if (!parentUserId) throw new Error('User not authenticated');
    // Returns the updated parent object (with students)
    return this.studentsService.delete(id, parentUserId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId) throw new Error('User not authenticated');

    return this.studentsService.update(id, body, userId, role);
  }

  @Get('me/notes')
  @UseGuards(JwtAuthGuard)
  async getMyNotes(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.getStudentNotes(userId);
  }

  @Get('me/sessions')
  @UseGuards(JwtAuthGuard)
  async getMySessions(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.getStudentSessions(userId);
  }
}
