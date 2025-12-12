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
    UploadedFile
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SessionsService } from './sessions.service';
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
    async uploadRecording(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
        // store to local disk or S3 and save metadata
        // In a real app we would upload to S3 here.
        // For now, we assume multer is configured to save to disk or memory.
        const path = file ? `/uploads/${file.filename}` : '';
        // TODO: move to storage (S3/Cloud)
        return { ok: true, path };
    }

    @UseGuards(JwtAuthGuard)
    @Get(':id/messages')
    getMessages(@Param('id') id: string) {
        return this.sessionsService.getMessages(id);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/messages')
    postMessage(@Param('id') id: string, @Body() dto: { text: string }, @Req() req: any) {
        return this.sessionsService.postMessage(id, req.user.userId, dto.text);
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