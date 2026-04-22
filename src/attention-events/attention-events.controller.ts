import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { AttentionEventsService } from './attention-events.service';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';

@Controller('sessions')
export class AttentionEventsController {
    constructor(private readonly attentionEventsService: AttentionEventsService) { }

    @UseGuards(ClerkAuthGuard)
    @Get(':id/attention-summary')
    async getSummary(@Param('id') id: string, @Req() req: any) {
        return this.attentionEventsService.getSummary(id);
    }

    @UseGuards(ClerkAuthGuard)
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
