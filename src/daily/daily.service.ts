import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
@Injectable()
export class DailyService {
    private readonly logger = new Logger(DailyService.name);
    private readonly apiKey = process.env.DAILY_API_KEY;
    private readonly apiUrl = 'https://api.daily.co/v1';
    async createRoom(sessionId: string) {
        const roomName = `k12-session-${sessionId}`;
        try {
            // 1. Try to get existing room (most likely scenario)
            const getResponse = await axios.get(`${this.apiUrl}/rooms/${roomName}`, {
                headers: { Authorization: `Bearer ${this.apiKey}` }
            });
            
            // 2. Synchronize properties to ensure auto-recording is enabled for old rooms
            await axios.post(
                `${this.apiUrl}/rooms/${roomName}`,
                {
                    properties: {
                        enable_screenshare: true,
                        enable_chat: false,
                        enable_recording: 'cloud',
                        start_cloud_recording: true,
                        exp: Math.floor(Date.now() / 1000) + 7200
                    }
                },
                { headers: { Authorization: `Bearer ${this.apiKey}` } }
            );

            return getResponse.data;
        } catch (err: any) {
            if (err.response?.status === 404) {
                // 2. Create if doesn't exist
                try {
                    this.logger.log(`Creating room: ${roomName}`);
                    const createResponse = await axios.post(
                        `${this.apiUrl}/rooms`,
                        {
                            name: roomName,
                            privacy: 'private',
                            properties: {
                                enable_screenshare: true,
                                enable_chat: false,
                                enable_recording: 'cloud',
                                start_cloud_recording: true,
                                exp: Math.floor(Date.now() / 1000) + 7200
                            }
                        },
                        {
                            headers: {
                                Authorization: `Bearer ${this.apiKey}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    return createResponse.data;
                } catch (createErr: any) {
                    // CRITICAL: Log the specific error reason from Daily API
                    this.logger.error('Room creation failed', createErr.response?.data);
                    throw createErr;
                }
            }
            this.logger.error('Get room failed', err.response?.data);
            throw new HttpException('Failed to create video room', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getRecordingAccessLink(recordingId: string): Promise<string> {
        try {
            const response = await axios.get(`${this.apiUrl}/recordings/${recordingId}/access-link`, {
                headers: { Authorization: `Bearer ${this.apiKey}` }
            });
            return response.data.download_link;
        } catch (err: any) {
            this.logger.error('Failed to get access link', err.response?.data);
            throw new HttpException('Failed to get recording access link', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async createMeetingToken(roomName: string, isOwner: boolean, userName: string): Promise<string> {
        try {
            const response = await axios.post(
                `${this.apiUrl}/meeting-tokens`,
                {
                    properties: {
                        room_name: roomName,
                        is_owner: isOwner,
                        user_name: userName,
                        enable_screenshare: true,
                        enable_recording: 'cloud',
                        start_video_off: true,
                        start_audio_off: true,
                        exp: Math.floor(Date.now() / 1000) + 7200
                    }
                },
                { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' } }
            );
            return response.data.token;
        } catch (err: any) {
            this.logger.error('Token creation failed', err.response?.data);
            throw new HttpException('Failed to create token', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
