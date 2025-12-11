import {
    Controller,
    Post,
    Body,
    UseGuards,
    Param,
    Get,
    Res,
    Req
} from '@nestjs/common';
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
}