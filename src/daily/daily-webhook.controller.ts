import { Controller, Post, Body, Logger } from '@nestjs/common';
import { AzureStorageService } from '../azure/azure-storage.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhooks/daily')
export class DailyWebhookController {
  private readonly logger = new Logger(DailyWebhookController.name);

  constructor(
    private readonly azureService: AzureStorageService,
    private readonly prisma: PrismaService 
  ) {}

  @Post()
  async handleRecordingWebhook(@Body() payload: any) {
    this.logger.log(`Received Daily.co webhook: ${payload.event}`);

    if (payload.event === 'recording.ready-to-download') {
      const { room_name, download_url } = payload.payload;
      
      // Extract sessionId from room_name (e.g., "k12-session-uuid" -> "uuid")
      const sessionId = room_name.replace('k12-session-', '');

      this.logger.log(`Recording ready for session: ${sessionId}. Starting transfer to Azure...`);

      try {
        // Stream from Daily.co directly to Azure
        const azureBlobName = await this.azureService.uploadFromUrl(sessionId, download_url);

        // Record in database
        await this.prisma.session_recordings.create({
          data: {
            session_id: sessionId,
            azure_blob_name: azureBlobName,
            mime_type: 'video/mp4',
          }
        });

        this.logger.log(`Successfully moved recording for session ${sessionId} to Azure: ${azureBlobName}`);
      } catch (error) {
        this.logger.error(`Failed to process recording for session ${sessionId}: ${error.message}`);
      }
    }

    return { received: true };
  }
}
