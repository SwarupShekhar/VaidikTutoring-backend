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
import { SendMessageDto } from './dto/send-message.dto';
import { UploadRecordingDto } from './dto/upload-recording.dto';
import { Response } from 'express';

@Controller('sessions')
export class SessionsController {
    constructor(private readonly sessionsService: SessionsService) { }

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
        res.setHeader('Content-Disposition', `attachment; filename=session_${id}.ics`);
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
        @Req() req: any
    ) {
        return this.sessionsService.postMessage(id, req.user.userId, dto.text);
    }

    // ==================== RECORDINGS ====================

    @UseGuards(JwtAuthGuard)
    @Get(':id/recordings')
    async getRecordings(@Param('id') id: string, @Req() req: any) {
        return this.sessionsService.getRecordings(id, req.user.userId);
    }

    @Post('validate-token')
    async validateToken(@Body() body: { sessionId: string; token: string }) {
        // Validate the specific session join token.
        // This token is separate from the main Auth JWT, or it could be a specialized JWT?
        // The user helper says: "Token should be a signed JWT containing { userId, role, sessionId }"
        // We need to decode/verify it.
        // For now, let's delegate to Service.
        return this.sessionsService.validateJoinToken(body.sessionId, body.token);
    }
}