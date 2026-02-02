import { Controller, Post, Body, Param, UseGuards, Get } from '@nestjs/common';
import { SessionPhasesService } from './session-phases.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Controller('sessions')
export class SessionPhasesController {
    constructor(private readonly sessionPhasesService: SessionPhasesService) { }

    @UseGuards(JwtAuthGuard)
    @Post(':id/phase')
    async updatePhase(
        @Param('id') id: string,
        @Body() body: { phase: any }
    ) {
        return this.sessionPhasesService.advancePhase(id, body.phase);
    }

    @UseGuards(JwtAuthGuard)
    @Get(':id/pedagogy-status')
    async getStatus(@Param('id') id: string) {
        // Logic could include fetching session and returning status
        return this.sessionPhasesService.evaluatePhaseBalance(id);
    }
}
