import { Controller, Post, Body, Logger, Inject, forwardRef } from '@nestjs/common';
import { AzureStorageService } from '../azure/azure-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';

@Controller('webhooks/daily')
export class DailyWebhookController {
  private readonly logger = new Logger(DailyWebhookController.name);

  constructor(
    private readonly azureService: AzureStorageService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SessionsService))
    private readonly sessionsService: SessionsService,
  ) {}

  @Post()
  async handleDailyWebhook(@Body() payload: any) {
    this.logger.log(`Received Daily.co webhook: ${payload.event}`);

    // 1. Handle Recording ready
    if (payload.event === 'recording.ready-to-download') {
      const { room_name, download_url } = payload.payload;
      const sessionId = this.extractSessionId(room_name);

      if (!sessionId) {
        this.logger.warn(`Could not extract sessionId from room_name: ${room_name}`);
        return { received: true };
      }

      this.logger.log(`Recording ready for session room: ${room_name}. Starting transfer to Azure...`);
      
      try {
        const resolvedSessionId = await this.sessionsService.ensureSessionId(sessionId);
        const azureBlobName = await this.azureService.uploadFromUrl(resolvedSessionId, download_url);
        await this.prisma.session_recordings.create({
          data: {
            session_id: resolvedSessionId,
            azure_blob_name: azureBlobName,
            mime_type: 'video/mp4',
          }
        });
        this.logger.log(`Successfully moved recording for session ${resolvedSessionId} to Azure: ${azureBlobName}`);
        
        // Mark as completed
        await this.completeSession(resolvedSessionId);
      } catch (error) {
        this.logger.error(`Failed to process recording for session ${sessionId}: ${error.message}`);
      }

      return { received: true, transfer: 'initiated' };
    }

    // 2. Handle Meeting Ended (Important for dashboard stats)
    if (payload.event === 'meeting.ended') {
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
      await this.sessionsService.updateSessionStatus(sessionId, 'completed');
    } catch (error) {
      this.logger.error(`Failed to mark session ${sessionId} as completed: ${error.message}`);
    }
  }
}
