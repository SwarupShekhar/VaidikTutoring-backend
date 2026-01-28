import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttentionEventType } from '../../generated/prisma/enums.js';

@Injectable()
export class AttentionEventsService {
    private readonly logger = new Logger(AttentionEventsService.name);

    constructor(private prisma: PrismaService) { }

    async createEvent(data: {
        sessionId: string;
        studentId: string;
        tutorId: string;
        type: AttentionEventType;
        metadata?: any;
    }) {
        const event = await this.prisma.attentionEvent.create({
            data: {
                sessionId: data.sessionId,
                studentId: data.studentId,
                tutorId: data.tutorId,
                type: data.type,
                metadata: data.metadata || {},
            },
        });

        // After creating an event, trigger a session evaluation asynchronously
        this.evaluateSessionAttention(data.sessionId).catch((err) =>
            this.logger.error(`Failed to evaluate session ${data.sessionId}: ${err.message}`),
        );

        return event;
    }

    async getSummary(sessionId: string) {
        const events = await this.prisma.attentionEvent.findMany({
            where: { sessionId },
        });

        const summary = {
            CHECK_IN: 0,
            EXPLANATION: 0,
            RESPONSE: 0,
            CORRECTION: 0,
            PRAISE: 0,
        };

        events.forEach((event) => {
            summary[event.type]++;
        });

        const types = Object.keys(summary);
        const loopsComplete = types.every((type) => summary[type as keyof typeof summary] > 0);

        // Personalization score logic: 
        // - Completeness gives 50 points (10 per unique loop type)
        // - Density (total events / session duration estimate) - for now simplified to total events count weight
        const uniqueTypesCount = types.filter(t => summary[t as keyof typeof summary] > 0).length;
        const personalizationScore = (uniqueTypesCount * 10) + Math.min(events.length * 2, 50);

        return {
            checkIn: summary.CHECK_IN,
            explanations: summary.EXPLANATION,
            responses: summary.RESPONSE,
            corrections: summary.CORRECTION,
            praises: summary.PRAISE,
            loopsComplete,
            personalizationScore: Math.min(personalizationScore, 100),
        };
    }

    async evaluateSessionAttention(sessionId: string) {
        const session = await this.prisma.sessions.findUnique({
            where: { id: sessionId },
            include: {
                attention_events: true,
            },
        });

        if (!session) return;

        const events = session.attention_events;
        const summary = this.calculateSummaryFromEvents(events);

        let status = 'HEALTHY';
        const alerts: string[] = [];

        // Rule 1: No CHECK_IN
        if (summary.CHECK_IN === 0) {
            status = 'LOW_PERSONALIZATION';
            alerts.push('No CHECK_IN loop detected');
        }

        // Rule 2: Fewer than 3 responses
        if (summary.RESPONSE < 3) {
            status = 'LOW_PERSONALIZATION';
            alerts.push('Low engagement: Student response loops < 3');
        }

        // Rule 3: No PRAISE
        if (summary.PRAISE === 0) {
            status = 'LOW_PERSONALIZATION';
            alerts.push('Missing positive reinforcement (PRAISE)');
        }

        await this.prisma.sessions.update({
            where: { id: sessionId },
            data: {
                attention_status: status,
                attention_meta: {
                    alerts,
                    lastEvaluated: new Date(),
                    scores: summary
                }
            }
        });

        return { status, alerts };
    }

    private calculateSummaryFromEvents(events: any[]) {
        const s = { CHECK_IN: 0, EXPLANATION: 0, RESPONSE: 0, CORRECTION: 0, PRAISE: 0 };
        events.forEach(e => {
            if (s.hasOwnProperty(e.type)) {
                s[e.type as keyof typeof s]++;
            }
        });
        return s;
    }
}
