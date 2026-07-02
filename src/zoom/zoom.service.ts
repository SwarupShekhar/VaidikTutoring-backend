import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { AzureStorageService } from '../azure/azure-storage.service';

@Injectable()
export class ZoomService {
  private readonly logger = new Logger(ZoomService.name);
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly azureStorage: AzureStorageService,
  ) {}

  private get credentials() {
    return {
      accountId: process.env.ZOOM_ACCOUNT_ID,
      clientId: process.env.ZOOM_CLIENT_ID,
      clientSecret: process.env.ZOOM_CLIENT_SECRET,
    };
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    // Buffer of 5 minutes (300,000 ms) to ensure token isn't expired
    if (this.accessToken && this.tokenExpiresAt && this.tokenExpiresAt > now + 300000) {
      return this.accessToken as string;
    }

    this.logger.log('Fetching new Zoom Access Token...');
    const { accountId, clientId, clientSecret } = this.credentials;

    if (!accountId || !clientId || !clientSecret) {
      throw new HttpException('Zoom API credentials are not configured properly.', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`;
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
      const response = await axios.post(
        tokenUrl,
        {},
        {
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      this.accessToken = response.data.access_token;
      // expires_in is in seconds, convert to ms
      this.tokenExpiresAt = now + response.data.expires_in * 1000;
      return this.accessToken as string;
    } catch (error) {
      this.logger.error('Failed to get Zoom Access Token', error.response?.data || error.message);
      throw new HttpException('Could not authenticate with Zoom.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createMeeting(topic: string, startTime: Date, durationMinutes: number) {
    const token = await this.getAccessToken();

    try {
      const response = await axios.post(
        'https://api.zoom.us/v2/users/me/meetings',
        {
          topic,
          type: 2, // Scheduled meeting
          start_time: startTime.toISOString(),
          duration: durationMinutes,
          timezone: 'UTC',
          settings: {
            host_video: true,
            participant_video: true,
            join_before_host: false,
            mute_upon_entry: true,
            watermark: false,
            use_pmi: false,
            // 2 = No registration required. Students come from StudyHours already
            // identified (dashboard auth) so the Zoom registration form is pure
            // friction; we capture attendance via our own table + the
            // participant_joined webhook.
            approval_type: 2,
            meeting_authentication: false, // Ensure participants don't have to log in to Zoom
            audio: 'both',
            auto_recording: 'cloud',
            waiting_room: false,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return {
        meetingId: String(response.data.id),
        joinUrl: response.data.join_url,
      };
    } catch (error) {
      // If unauthorized, token might have been revoked/expired before our buffer.
      // We could add retry logic here if needed.
      this.logger.error('Failed to create Zoom meeting', error.response?.data || error.message);
      throw new HttpException('Failed to create Zoom meeting.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateMeeting(meetingId: string, topic: string, startTime: Date, durationMinutes: number) {
    const token = await this.getAccessToken();

    try {
      await axios.patch(
        `https://api.zoom.us/v2/meetings/${meetingId}`,
        {
          topic,
          start_time: startTime.toISOString(),
          duration: durationMinutes,
          settings: {
            approval_type: 2, // No registration required (keeps reschedules consistent with createMeeting)
            meeting_authentication: false, // Ensure participants don't have to log in
            waiting_room: false, // Allow instant entry
          }
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to update Zoom meeting ${meetingId}`, error.response?.data || error.message);
      throw new HttpException('Failed to update Zoom meeting.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteMeeting(meetingId: string): Promise<void> {
    const token = await this.getAccessToken();

    try {
      await axios.delete(`https://api.zoom.us/v2/meetings/${meetingId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(`Deleted Zoom meeting ${meetingId}`);
    } catch (error) {
      // Tolerant: if the meeting is already gone (404), treat as success.
      if (error.response?.status === 404) {
        this.logger.warn(`Zoom meeting ${meetingId} not found (already deleted); skipping.`);
        return;
      }
      this.logger.error(`Failed to delete Zoom meeting ${meetingId}`, error.response?.data || error.message);
      throw new HttpException('Failed to delete Zoom meeting.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Currently unused: meetings run with approval_type: 2 (no registration), so
  // students join directly. Kept for a future opt-in per-registrant flow (would
  // require flipping createMeeting back to approval_type 0/1).
  async registerParticipant(meetingId: string, email: string, firstName: string, lastName: string): Promise<string> {
    const token = await this.getAccessToken();

    try {
      const response = await axios.post(
        `https://api.zoom.us/v2/meetings/${meetingId}/registrants`,
        {
          email,
          first_name: firstName || 'Student',
          last_name: lastName || 'User',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data.join_url;
    } catch (error: any) {
      this.logger.error(`Failed to register participant for Zoom meeting ${meetingId}`, error.response?.data || error.message);
      console.log('ZOOM REGISTRATION FAILED:', error.response?.data || error.message);
      // Fallback: If registration fails or is disabled for this meeting, just return the base join URL 
      // by fetching the meeting details, or throwing an error if strict attendance is required.
      throw new HttpException('Failed to register participant.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async processRecordingWebhook(meetingId: string, downloadUrl: string, fileSize: number, duration: number) {
    try {
      this.logger.log(`Processing recording for Zoom meeting ${meetingId}...`);
      
      const session = await this.prisma.sessions.findFirst({
        where: { zoom_meeting_id: meetingId },
        orderBy: { created_at: 'desc' },
      });

      if (!session) {
        this.logger.warn(`No session found for Zoom meeting ID: ${meetingId}`);
        return;
      }

      const token = await this.getAccessToken();
      // Zoom requires the token as an access_token query param for direct downloads
      const urlWithToken = `${downloadUrl}?access_token=${token}`;
      const headers = { Authorization: `Bearer ${token}` };
      
      const azureBlobName = await this.azureStorage.uploadFromUrl(session.id, urlWithToken, headers);
      
      await this.prisma.session_recordings.create({
        data: {
          session_id: session.id,
          azure_blob_name: azureBlobName,
          mime_type: 'video/mp4',
          file_size_bytes: fileSize,
          duration_seconds: duration,
        }
      });

      this.logger.log(`Successfully moved recording for session ${session.id} to Azure: ${azureBlobName}`);

      // Delete the recording from Zoom to save space
      await this.deleteRecording(meetingId);
      
    } catch (error) {
      this.logger.error(`Failed to process recording for Zoom meeting ${meetingId}: ${error.message}`);
    }
  }

  async deleteRecording(meetingId: string) {
    const token = await this.getAccessToken();
    try {
      await axios.delete(`https://api.zoom.us/v2/meetings/${meetingId}/recordings`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { action: 'trash' }
      });
      this.logger.log(`Deleted Zoom recording for meeting ${meetingId}`);
    } catch (e: any) {
      this.logger.error(`Failed to delete Zoom recording for ${meetingId}`, e.message);
    }
  }
}
