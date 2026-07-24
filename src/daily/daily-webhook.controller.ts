import { Controller, Post, Body, Logger, Inject, forwardRef, UseGuards } from '@nestjs/common';
import { AzureStorageService } from '../azure/azure-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { DailyService } from './daily.service';
import { DailyWebhookGuard } from './daily-webhook.guard';
import { ConfigService } from '@nestjs/config';

@UseGuards(DailyWebhookGuard)
@Controller('webhooks/daily')
export class DailyWebhookController {
  private readonly logger = new Logger(DailyWebhookController.name);

  constructor(
    private readonly azureService: AzureStorageService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SessionsService))
    private readonly sessionsService: SessionsService,
    private readonly dailyService: DailyService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  async handleDailyWebhook(@Body() payload: any) {
    this.logger.log(`Received Daily.co webhook: ${payload.type}`);

    // 1. Handle Recording ready
    if (payload.type === 'recording.ready-to-download') {
      const { room_name, recording_id } = payload.payload;
      const sessionId = this.extractSessionId(room_name);

      if (!sessionId) {
        this.logger.warn(`Could not extract sessionId from room_name: ${room_name}`);
        return { received: true };
      }

      this.logger.log(`Recording ready for session room: ${room_name}. Starting transfer to Azure...`);

      // Process asynchronously so we can return 201 immediately to Daily.co
      Promise.resolve().then(async () => {
        // Bounded retry with exponential backoff. Daily purges its copy after
        // retention, so a transient Azure/network blip must not lose the recording.
        // ponytail: this is in-process retry only — it survives transient failures,
        // but a backend restart mid-retry still loses the recording. The upgrade
        // path is a persisted "pending_transfer" DB row drained by a cron (needs a
        // schema change — intentionally NOT built here).
        const backoffsMs = [2000, 8000, 32000]; // 2s, 8s, 32s
        const maxAttempts = backoffsMs.length;

        let resolvedSessionId: string | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            resolvedSessionId = await this.sessionsService.ensureSessionId(sessionId);
            const downloadUrl = await this.dailyService.getRecordingAccessLink(recording_id);
            const azureBlobName = await this.azureService.uploadFromUrl(resolvedSessionId, downloadUrl);
            await this.prisma.session_recordings.create({
              data: {
                session_id: resolvedSessionId,
                azure_blob_name: azureBlobName,
                mime_type: 'video/mp4',
                // 29-day retention, matching the Azure blob lifecycle policy. Without
                // this, webhook-created recordings never expire.
                auto_delete_at: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
              }
            });
            this.logger.log(`Successfully moved recording for session ${resolvedSessionId} to Azure: ${azureBlobName}`);

            // Mark as completed only after a successful transfer
            await this.completeSession(resolvedSessionId);
            return;
          } catch (error) {
            if (attempt < maxAttempts) {
              const delayMs = backoffsMs[attempt - 1];
              this.logger.warn(
                `Recording transfer attempt ${attempt}/${maxAttempts} failed for session ${sessionId}: ${error.message}. Retrying in ${delayMs}ms...`,
              );
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            } else {
              this.logger.error(
                `RECORDING LOST: all ${maxAttempts} transfer attempts failed for session ${sessionId} (recording_id ${recording_id}, room ${room_name}). Daily will purge its copy after retention. Last error: ${error.message}`,
              );
            }
          }
        }
      });

      return { received: true, transfer: 'initiated' };
    }

    // 2. Handle Meeting Ended (Important for dashboard stats)
    if (payload.type === 'meeting.ended') {
      const roomName = payload.payload?.room || payload.payload?.room_name;
      const sessionId = this.extractSessionId(roomName);

      if (sessionId) {
        try {
          const resolvedSessionId = await this.sessionsService.ensureSessionId(sessionId);
          this.logger.log(`Meeting ended for session: ${resolvedSessionId}. Marking as completed.`);
          await this.completeSession(resolvedSessionId);
        } catch (error) {
          this.logger.error(`Failed to handle meeting end for ${sessionId}: ${error.message}`);
        }
      }
      return { received: true };
    }

    // 3. Handle Participant Joined / Left (Attendance)
    if (payload.type === 'participant.joined' || payload.type === 'participant.left') {
      const roomName = payload.payload?.room || payload.payload?.room_name;
      const sessionId = this.extractSessionId(roomName);
      const userId = payload.payload?.participant?.user_id;

      if (sessionId && userId) {
        try {
          const resolvedSessionId = await this.sessionsService.ensureSessionId(sessionId);
          
          // Find the student record for this user
          const student = await this.prisma.students.findFirst({
            where: { user_id: userId }
          });

          if (student) {
            const joined = payload.type === 'participant.joined';
            
            await this.prisma.attendance.upsert({
              where: {
                sessionId_studentId: {
                  sessionId: resolvedSessionId,
                  studentId: student.id
                }
              },
              create: {
                sessionId: resolvedSessionId,
                studentId: student.id,
                present: joined,
                joinedAt: joined ? new Date() : null,
                leftAt: joined ? null : new Date()
              },
              update: {
                present: joined,
                joinedAt: joined ? new Date() : undefined,
                leftAt: joined ? null : new Date()
              }
            });
            
            this.logger.log(`Marked attendance for student ${student.id} in session ${resolvedSessionId} (Daily joined: ${joined})`);
          }
        } catch (error) {
          this.logger.error(`Failed to handle attendance for daily session ${sessionId}: ${error.message}`);
        }
      }
      return { received: true };
    }

    return { received: true };
  }

  private extractSessionId(roomName: string): string | null {
    if (!roomName) return null;
    // Handle "k12-session-UUID" or "daily-room-UUID"
    if (roomName.startsWith('k12-session-')) {
      return roomName.replace('k12-session-', '');
    }
    if (roomName.startsWith('daily-room-')) {
      return roomName.replace('daily-room-', '');
    }
    return roomName; // Fallback
  }

  private async completeSession(sessionId: string) {
    try {
      await this.sessionsService.updateSessionStatus(sessionId, 'completed', 'system');
    } catch (error) {
      this.logger.error(`Failed to mark session ${sessionId} as completed: ${error.message}`);
    }
  }
}
