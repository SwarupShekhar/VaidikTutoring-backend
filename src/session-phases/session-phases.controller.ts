import { Controller, Post, Body, Param, UseGuards, Get } from '@nestjs/common';
import { SessionPhasesService } from './session-phases.service';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';

@Controller('sessions')
export class SessionPhasesController {
    constructor(private readonly sessionPhasesService: SessionPhasesService) { }

    @UseGuards(ClerkAuthGuard)
    @Post(':id/phase')
    async updatePhase(
        @Param('id') id: string,
        @Body() body: { phase: any }
    ) {
        return this.sessionPhasesService.advancePhase(id, body.phase);
    }

    @UseGuards(ClerkAuthGuard)
    @Get(':id/pedagogy-status')
    async getStatus(@Param('id') id: string) {
        // Logic could include fetching session and returning status
        return this.sessionPhasesService.evaluatePhaseBalance(id);
    }
}
