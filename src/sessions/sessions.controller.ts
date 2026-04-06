import {
  Controller,
  Post,
  Patch,
  Body,
  UseGuards,
  Param,
  Get,
  Res,
  Req,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SessionsService } from './sessions.service';
import { DailyService } from '../daily/daily.service';
import { SendMessageDto } from './dto/send-message.dto';
import { UploadRecordingDto } from './dto/upload-recording.dto';
import { Response } from 'express';
import { EmailVerifiedGuard } from '../auth/email-verified.guard';
import { PasswordChangeGuard } from '../auth/password-change.guard';
import { TutorStatusGuard } from '../auth/tutor-status.guard';
import { memoryStorage } from 'multer';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly dailyService: DailyService,
  ) { }

  // Create a session (basic)
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Post('create')
  create(@Body() dto: any) {
    return this.sessionsService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Req() req: any) {
    const userId = req.user.userId;
    return this.sessionsService.findAllForUser(userId);
  }

  // Generate downloadable ICS invite
  @UseGuards(JwtAuthGuard)
  @Get(':id/invite')
  async getInvite(@Param('id') id: string, @Res() res: Response) {
    const ics = await this.sessionsService.generateIcsInvite(id);

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=session_${id}.ics`,
    );
    res.send(ics);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/recordings')
  @UseInterceptors(FileInterceptor('file'))
  async uploadRecording(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 500 * 1024 * 1024 }), // 500MB
          new FileTypeValidator({ fileType: 'video/mp4' }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadRecordingDto,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Placeholder: In a real local setup, Multer would save this to disk.
    // Here we just simulate a path.
    const fileUrl = `/uploads/recordings/${Date.now()}-${file.originalname}`;

    return this.sessionsService.uploadRecording(
      id,
      req.user.userId,
      fileUrl,
      file.size,
      dto.duration_seconds,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Req() req: any) {
    return this.sessionsService.getMessages(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/messages')
  postMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: any,
  ) {
    return this.sessionsService.postMessage(id, req.user.userId, dto.text);
  }

  // ==================== RECORDINGS ====================

  @UseGuards(JwtAuthGuard)
  @Get(':id/recordings')
  async getRecordings(@Param('id') id: string, @Req() req: any) {
    return this.sessionsService.getRecordings(id, req.user.userId);
  }



  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
  @Get(':id/daily-token')
  async getDailyToken(@Param('id') sessionId: string, @Req() req: any) {
    const user = req.user;

    // VALIDATION: Ensure session/booking exists and user has access
    // This prevents generating tokens for deleted bookings or unauthorized access
    // Pass user.role === 'admin' logic if admin should always have access?
    // Current helper checks specific ownership.
    if (user.role !== 'admin') {
      await this.sessionsService.verifySessionOrBookingAccess(sessionId, user.userId);
    } else {
      // Admin: just check existence
      try {
        await this.sessionsService.verifySessionOrBookingAccess(sessionId, user.userId);
      } catch (e) {
        // If 403, ignore for admin. If 404, throw.
        if (e instanceof Error && e.message.includes('not found')) throw e;
        // If 403 Forbidden, Admin overrides it.
      }
    }

    // Create or get Daily.co room
    const room = await this.dailyService.createRoom(sessionId);

    // Determine if user is owner (tutor/admin)
    const isOwner = user.role === 'tutor' || user.role === 'admin';

    // Generate meeting token
    const userName = user.first_name || user.email || 'User';
    const token = await this.dailyService.createMeetingToken(
      room.name,
      isOwner,
      userName
    );

    return {
      roomUrl: room.url,
      token: token
    };
  }

  @Post('validate-token')
  async validateToken(@Body() body: { sessionId: string; token: string }) {
    // Validate the specific session join token.
    return this.sessionsService.validateJoinToken(body.sessionId, body.token);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/attendance')
  async recordAttendance(
    @Param('id') id: string,
    @Body() body: {
      studentId: string;
      present: boolean;
      minutesAttended?: number;
    },
    @Req() req: any
  ) {
    // Typically only Tutors or Admins record attendance
    if (req.user.role !== 'admin' && req.user.role !== 'tutor') {
      // Additional check: is this tutor assigned to this session?
      // Service logic handles specific permission checks usually, or here.
      // Let's defer to service or throw if not staff.
    }
    return this.sessionsService.recordAttendance(id, body.studentId, body.present, body.minutesAttended);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/slides')
  @UseInterceptors(FileInterceptor('file', { 
    storage: memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // Increase limit to 50MB for large PDFs
  }))
  async uploadSlides(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Return the file as base64 instead of saving to disk
    const base64 = file.buffer.toString('base64');
    const dataUrl = `data:${file.mimetype};base64,${base64}`;

    return { 
        success: true, 
        base64: dataUrl, 
        mimeType: file.mimetype,
        originalName: file.originalname 
    };
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Patch(':id/tutor-note')
  async updateTutorNote(
    @Param('id') id: string,
    @Body() body: { note: string },
    @Req() req: any,
  ) {
    if (req.user.role !== 'tutor') {
      throw new UnauthorizedException('Only tutors can add notes');
    }
    return this.sessionsService.updateTutorNote(id, req.user.userId, body.note);
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  // Assumes you have Roles and RolesGuard imported and applied at class or method level
  // Actually, RolesGuard needs to be added here.
  @Get(':id/admin-summary')
  async getAdminSummary(@Param('id') id: string, @Req() req: any) {
    if (req.user.role !== 'admin') {
      throw new UnauthorizedException('Admin only');
    }
    return this.sessionsService.getAdminSummary(id);
  }

}

