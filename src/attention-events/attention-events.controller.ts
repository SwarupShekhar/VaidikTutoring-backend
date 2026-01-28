import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { AttentionEventsService } from './attention-events.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('sessions')
export class AttentionEventsController {
    constructor(private readonly attentionEventsService: AttentionEventsService) { }

    @UseGuards(JwtAuthGuard)
    @Get(':id/attention-summary')
    async getSummary(@Param('id') id: string, @Req() req: any) {
        return this.attentionEventsService.getSummary(id);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/attention-event')
    async createEvent(
        @Param('id') sessionId: string,
        @Body() body: { type: any; studentId: string; tutorId: string; metadata?: any },
    ) {
        return this.attentionEventsService.createEvent({
            sessionId,
            ...body,
        });
    }
}
