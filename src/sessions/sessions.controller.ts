import {
  Controller,
  Post,
  Body,
  UseGuards,
  Param,
  Get,
  Res,
  Req,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SessionsService } from './sessions.service';
import { DailyService } from '../daily/daily.service';
import { SendMessageDto } from './dto/send-message.dto';
import { UploadRecordingDto } from './dto/upload-recording.dto';
import { Response } from 'express';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly dailyService: DailyService,
  ) { }

  // Create a session (basic)
  @UseGuards(JwtAuthGuard)
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
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadRecordingDto,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // TODO: Upload file to S3/Cloudinary and get URL
    // For now, using a local path as placeholder
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



  @UseGuards(JwtAuthGuard)
  @Get(':id/daily-token')
  async getDailyToken(@Param('id') sessionId: string, @Req() req: any) {
    const user = req.user;

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
}

// Compatibility Controller for frontend using singular 'session'
@Controller('session')
export class LegacySessionController {
  constructor(private readonly sessionsService: SessionsService) { }

  @UseGuards(JwtAuthGuard)
  @Get(':id/token')
  async getToken(@Param('id') id: string, @Req() req: any) {
    // Maps /session/:id/token -> service logic
    const token = await this.sessionsService.generateTokenForSession(id, req.user.userId);
    return { token };
  }
}
