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
  Query,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { StudentsService } from './students.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CreditsService } from '../credits/credits.service';
import { BookingsService } from '../bookings/bookings.service';
import { RatingsService } from '../ratings/ratings.service';

@Controller('students')
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly creditsService: CreditsService,
    private readonly bookingsService: BookingsService,
    private readonly ratingsService: RatingsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  @Post()
  @UseGuards(ClerkAuthGuard)
  async create(@Body() body: any, @Req() req: any) {
    // Ideally use a DTO class for body
    // req.user is populated by JwtStrategy, which returns { userId, email, role }
    const parentUserId = req.user?.userId;

    if (!parentUserId) {
      throw new Error('User not authenticated');
    }

    return this.studentsService.create(body, parentUserId);
  }

  // Adult learner (18+) self-consent to recording their own sessions. Minors are
  // rejected server-side — they need a parent/guardian.
  @Patch('me/recording-consent')
  @UseGuards(ClerkAuthGuard)
  async setMyRecordingConsent(
    @Body() body: { granted: boolean; birthDate?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new NotFoundException('User not authenticated');
    return this.studentsService.setMyRecordingConsent(userId, !!body?.granted, body?.birthDate);
  }

  @Patch('me')
  @UseGuards(ClerkAuthGuard)
  async completeMyOnboarding(@Body() body: any, @Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new NotFoundException('User not authenticated');
    return this.studentsService.completeMyOnboarding(userId, body);
  }

  // Record a finished practice session: award XP + update the daily practice streak.
  @Post('me/practice-result')
  @UseGuards(ClerkAuthGuard)
  async recordPracticeResult(@Body() body: { xp?: number }, @Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new NotFoundException('User not authenticated');
    return this.studentsService.recordPracticeResult(userId, Math.max(0, Math.floor(Number(body?.xp) || 0)));
  }

  @Get('me')
  @UseGuards(ClerkAuthGuard)
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

  @Get('me/dashboard-summary')
  @UseGuards(ClerkAuthGuard)
  async getMyDashboardSummary(@Req() req: any) {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId) throw new Error('User not authenticated');

    const cacheKey = `dashboard:student:${userId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const student = await this.studentsService.findByUserId(userId);
    if (!student) {
      throw new NotFoundException('Student profile not found');
    }

    const [creditStatus, enrollmentStatus, progressSummary, bookings, pendingRatings] = await Promise.all([
      this.creditsService.getCreditStatus(student),
      this.studentsService.getEnrollmentStatus(student.id),
      this.studentsService.getProgressSummary(student.id),
      this.bookingsService.forStudent(userId),
      this.ratingsService.getPendingRatings(userId, role),
    ]);

    const result = {
      profile: { ...student, creditStatus },
      enrollmentStatus,
      progressSummary,
      bookings,
      pendingRatings,
    };

    // Cache for 30 seconds — dashboard data is stable within a session
    await this.cacheManager.set(cacheKey, result, 30_000);
    return result;
  }

  @Get('me/progress-summary')
  @UseGuards(ClerkAuthGuard)
  async getMyProgressSummary(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    const student = await this.studentsService.findByUserId(userId);
    if (!student) throw new NotFoundException('Student profile not found');
    return this.studentsService.getProgressSummary(student.id);
  }

  @Get('parent')
  @UseGuards(ClerkAuthGuard)
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
  @UseGuards(ClerkAuthGuard)
  async getById(@Param('id') id: string, @Req() req: any) {
    await this.studentsService.assertStudentAccess(id, req.user?.userId, req.user?.role);
    const student = await this.studentsService.findUniqueById(id);
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  @Get(':id/enrollment-status')
  @UseGuards(ClerkAuthGuard)
  async getEnrollmentStatus(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    await this.studentsService.assertStudentAccess(id, userId, req.user?.role);
    return this.studentsService.getEnrollmentStatus(id);
  }

  @Get(':id/progress-summary')
  @UseGuards(ClerkAuthGuard)
  async getProgressSummary(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    await this.studentsService.assertStudentAccess(id, userId, req.user?.role);
    return this.studentsService.getProgressSummary(id);
  }

  @Get(':id/attendance-report')
  @UseGuards(ClerkAuthGuard)
  async getAttendanceReport(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.getStudentAttendanceReport(id, userId, role);
  }

  @Post(':id/update-streak')
  @UseGuards(ClerkAuthGuard)
  async updateStreak(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    await this.studentsService.assertStudentAccess(id, userId, req.user?.role);
    return this.studentsService.updateStreak(id);
  }

  @Delete(':id')
  @UseGuards(ClerkAuthGuard)
  async delete(@Param('id') id: string, @Req() req: any) {
    const parentUserId = req.user?.userId;
    if (!parentUserId) throw new Error('User not authenticated');
    // Returns the updated parent object (with students)
    return this.studentsService.delete(id, parentUserId);
  }

  @Patch(':id')
  @UseGuards(ClerkAuthGuard)
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId) throw new Error('User not authenticated');

    return this.studentsService.update(id, body, userId, role);
  }

  // Paid student requests to reschedule a pre-scheduled class → admin queue.
  @Post('me/reschedule-requests')
  @UseGuards(ClerkAuthGuard)
  async requestReschedule(
    @Body() body: { sessionId: string; reason?: string; preferredSlots?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new NotFoundException('User not authenticated');
    return this.studentsService.createRescheduleRequest(userId, body);
  }

  @Get('me/reschedule-requests')
  @UseGuards(ClerkAuthGuard)
  async myRescheduleRequests(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new NotFoundException('User not authenticated');
    return this.studentsService.getMyRescheduleRequests(userId);
  }

  // `studentId` lets a parent fetch a specific child's notes (parent-owns-child
  // verified in the service). Students omit it and get their own.
  @Get('me/notes')
  @UseGuards(ClerkAuthGuard)
  async getMyNotes(@Req() req: any, @Query('studentId') studentId?: string) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.getStudentNotes(userId, studentId);
  }

  @Get('me/sessions')
  @UseGuards(ClerkAuthGuard)
  async getMySessions(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('User not authenticated');
    return this.studentsService.getStudentSessions(userId);
  }
}
