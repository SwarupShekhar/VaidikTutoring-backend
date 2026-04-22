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
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { SessionsService } from './sessions.service';
import { DailyService } from '../daily/daily.service';
import { PrismaService } from '../prisma/prisma.service';
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
    private readonly prisma: PrismaService,
  ) { }

  // Create a session (basic)
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Post('create')
  create(@Body() dto: any) {
    return this.sessionsService.create(dto);
  }

  @UseGuards(ClerkAuthGuard)
  @Get()
  async findAll(@Req() req: any) {
    const userId = req.user.userId;
    return this.sessionsService.findAllForUser(userId);
  }

  // Generate downloadable ICS invite
  @UseGuards(ClerkAuthGuard)
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

  @UseGuards(ClerkAuthGuard)
  @Post(':id/recordings')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
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

    return this.sessionsService.uploadRecording(
      id,
      req.user.userId,
      file.buffer,
      file.mimetype,
      file.size,
      dto.duration_seconds,
    );
  }

  @UseGuards(ClerkAuthGuard)
  @Get(':id/recordings/:recordingId/stream')
  async streamRecording(
    @Param('id') id: string,
    @Param('recordingId') recordingId: string,
    @Req() req: any,
  ) {
    return this.sessionsService.generateRecordingSasUrl(id, recordingId, req.user.userId);
  }

  @UseGuards(ClerkAuthGuard)
  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Req() req: any) {
    return this.sessionsService.getMessages(id, req.user.userId);
  }

  @UseGuards(ClerkAuthGuard)
  @Post(':id/messages')
  postMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: any,
  ) {
    return this.sessionsService.postMessage(id, req.user.userId, dto.text);
  }

  // ==================== RECORDINGS ====================

  @UseGuards(ClerkAuthGuard)
  @Get(':id/recordings')
  async getRecordings(@Param('id') id: string, @Req() req: any) {
    return this.sessionsService.getRecordings(id, req.user.userId);
  }



  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard, TutorStatusGuard)
  @Get(':id/daily-token')
  async getDailyToken(@Param('id') idOrBookingId: string, @Req() req: any) {
    const user = req.user;

    // 1. Resolve to canonical Session ID so everyone ends up in the same Daily room
    // This allows passing either a Booking ID or a Session ID
    const sessionId = await this.sessionsService.ensureSessionId(idOrBookingId);

    // 2. VALIDATION: Ensure user has access
    if (user.role !== 'admin') {
      await this.sessionsService.verifySessionOrBookingAccess(sessionId, user.userId);
    }

    // 3. Create or get Daily.co room using Canonical Session ID
    const room = await this.dailyService.createRoom(sessionId);

    // Determine if user is owner (tutor/admin)
    const isOwner = user.role === 'tutor' || user.role === 'admin';

    // Generate meeting token
    const userName = user.first_name || user.display_name || user.email || 'User';
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

  @UseGuards(ClerkAuthGuard)
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
      throw new ForbiddenException('Only staff can record attendance');
    }
    return this.sessionsService.recordAttendance(id, body.studentId, body.present, body.minutesAttended);
  }

  @UseGuards(ClerkAuthGuard)
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

    // 1. Upload to Azure
    const blobName = await this.sessionsService.uploadSlide(id, file.buffer, file.mimetype, file.originalname);

    // 2. Generate 1 hour SAS URL
    const sasData = await this.sessionsService.generateSlideSasUrl(id, blobName);

    return { 
        success: true, 
        sasUrl: sasData.sasUrl,
        expiresIn: sasData.expiresIn,
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
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Req() req: any,
  ) {
    // Only tutor or admin can update status
    if (req.user.role !== 'tutor' && req.user.role !== 'admin') {
      throw new UnauthorizedException('Only tutors or admins can update session status');
    }
    return this.sessionsService.updateSessionStatus(id, body.status, req.user.userId);
  }

  // FIX 3: Unified endpoint to end a session
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Post(':id/end')
  async endSession(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    // Anyone in the session (tutor, student, parent, admin) can end it
    // The service method will verify access
    return this.sessionsService.endSession(id, req.user.userId);
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

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Get(':id/whiteboard-snapshot/stream')
  async streamSnapshot(
    @Param('id') id: string,
    @Req() req: any
  ) {
    return this.sessionsService.getWhiteboardSnapshotSasUrl(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Post(':id/whiteboard-snapshot')
  async saveWhiteboardSnapshot(
    @Param('id') id: string,
    @Body() body: { snapshotUrl: string },
    @Req() req: any,
  ) {
    if (req.user.role !== 'tutor' && req.user.role !== 'admin') {
      throw new UnauthorizedException('Only tutors can save snapshots');
    }
    return this.sessionsService.saveWhiteboardSnapshot(id, req.user.userId, body.snapshotUrl);
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Get('stickers/:studentId')
  async getStickers(@Param('studentId') studentId: string, @Req() req: any) {
    const user = req.user;
    const student = await this.prisma.students.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    // Auth logic: User or Parent can see theirs/child's. Admin can see all.
    if (user.role === 'admin') return this.sessionsService.getStickers(studentId);

    if (user.role === 'student' && student.user_id === user.userId) return this.sessionsService.getStickers(studentId);

    if (user.role === 'parent' && student.parent_user_id === user.userId) return this.sessionsService.getStickers(studentId);

    throw new ForbiddenException('You do not have access to these stickers');
  }

  // ==================== CLASS NOTES ====================

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Post(':id/notes')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async shareNote(
    @Param('id') sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { title: string; note_type: string; content?: string },
    @Req() req: any,
  ) {
    return this.sessionsService.shareNote(
      sessionId,
      req.user.userId,
      body.title,
      body.note_type || 'general',
      file?.buffer,
      file?.mimetype,
      file?.originalname,
      body.content,
    );
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Post(':id/shared-pdf')
  @UseInterceptors(FileInterceptor('file', { 
    storage: memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // Increase limit to 50MB for annotated whiteboard PDFs
  }))
  async sharePdf(
    @Param('id') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    return this.sessionsService.shareNote(
      sessionId,
      req.user.userId,
      'Whiteboard Annotations',
      'whiteboard_pdf',
      file.buffer,
      file.mimetype,
      file.originalname,
      'Automated export of whiteboard annotations',
    );
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Get(':id/notes')
  async getSessionNotes(@Param('id') sessionId: string, @Req() req: any) {
    return this.sessionsService.getSessionNotes(sessionId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PasswordChangeGuard)
  @Get('notes/:noteId/download')
  async downloadNote(@Param('noteId') noteId: string, @Req() req: any) {
    return this.sessionsService.generateNoteSasUrl(noteId, req.user.userId);
  }
}
