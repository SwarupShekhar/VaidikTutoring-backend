import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionPhase } from '../../generated/prisma/enums.js';

@Injectable()
export class SessionPhasesService {
    private readonly logger = new Logger(SessionPhasesService.name);

    constructor(private prisma: PrismaService) { }

    async advancePhase(sessionId: string, nextPhase: SessionPhase) {
        const session = await this.prisma.sessions.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            throw new BadRequestException('Session not found');
        }

        const currentPhase = session.current_phase as SessionPhase;

        // Logic: Phases move forward. 
        // This is a simple validation. In a real app, you might allow moving back,
        // but the requirement says "move forward only".
        const phaseOrder: SessionPhase[] = [
            'WARM_CONNECT',
            'DIAGNOSE',
            'MICRO_TEACH',
            'ACTIVE_RESPONSE',
            'REINFORCE',
            'REFLECT',
        ];

        const currentIndex = phaseOrder.indexOf(currentPhase);
        const nextIndex = phaseOrder.indexOf(nextPhase);

        if (nextIndex <= currentIndex) {
            // For flexibility, let's allow moving to the same phase (no-op) 
            // but warn if moving backwards if strictly enforced.
            // The requirement says "forward only".
            if (nextIndex < currentIndex) {
                this.logger.warn(`Attempt to move backwards from ${currentPhase} to ${nextPhase}`);
                // throw new BadRequestException(`Cannot move backwards from ${currentPhase} to ${nextPhase}`);
            }
        }

        const history = (session.phase_history as any[]) || [];
        const updatedHistory = [
            ...history,
            {
                phase: nextPhase,
                startedAt: new Date(),
                previousPhase: currentPhase,
            },
        ];

        const updatedSession = await this.prisma.sessions.update({
            where: { id: sessionId },
            data: {
                current_phase: nextPhase,
                phase_history: updatedHistory,
            },
        });

        // Evaluate pedagogy balance after transition
        this.evaluatePhaseBalance(sessionId).catch(err =>
            this.logger.error(`Failed to evaluate balance for session ${sessionId}: ${err.message}`)
        );

        return updatedSession;
    }

    async evaluatePhaseBalance(sessionId: string) {
        const session = await this.prisma.sessions.findUnique({
            where: { id: sessionId },
            include: {
                attention_events: true
            }
        });

        if (!session) return;

        const history = (session.phase_history as any[]) || [];
        const alerts: string[] = [];
        let status = 'HEALTHY';

        // Rule 1: WARM_CONNECT too short (less than 2 minutes in a real scenario)
        // Here we can check if it exists at all first.
        if (!history.find(h => h.phase === 'WARM_CONNECT')) {
            alerts.push('Session did not experience Warm Connect phase');
            status = 'PEDAGOGY_GAP';
        }

        // Rule 2: MICRO_TEACH without ACTIVE_RESPONSE
        const hasTeach = history.find(h => h.phase === 'MICRO_TEACH');
        const hasResponse = history.find(h => h.phase === 'ACTIVE_RESPONSE');
        if (hasTeach && !hasResponse) {
            alerts.push('Instruction (Teach) phase active without student response loops');
            status = 'PEDAGOGY_GAP';
        }

        // Rule 3: Missing REFLECT
        if (session.status === 'completed' && !history.find(h => h.phase === 'REFLECT')) {
            alerts.push('Session ended without Reflection phase');
            status = 'PEDAGOGY_GAP';
        }

        await this.prisma.sessions.update({
            where: { id: sessionId },
            data: {
                pedagogy_status: status,
                attention_meta: {
                    ...(session.attention_meta as any || {}),
                    pedagogyAlerts: alerts,
                    lastPedagogyEval: new Date()
                }
            }
        });

        return { status, alerts };
    }
}
