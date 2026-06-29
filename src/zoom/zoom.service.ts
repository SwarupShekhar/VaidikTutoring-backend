import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ZoomService {
  private readonly logger = new Logger(ZoomService.name);
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;

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
            approval_type: 0, // Automatically approve
            audio: 'both',
            auto_recording: 'cloud',
            waiting_room: true,
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
}
