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
} from '@nestjs/common';
import { StudentsService } from './students.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

// Assuming you have an AuthGuard or similar to get the user
// If not, you might need to extract userId differently.
// Standard pattern: @UseGuards(JwtAuthGuard)
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) { }

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
    return this.studentsService.create(body, parentUserId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyProfile(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.findByUserId(userId);
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
}
