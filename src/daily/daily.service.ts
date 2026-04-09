import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class DailyService {
    private readonly logger = new Logger(DailyService.name);
    private readonly apiKey = process.env.DAILY_API_KEY;
    private readonly apiUrl = 'https://api.daily.co/v1';

    async createRoom(sessionId: string) {
        if (!this.apiKey) {
            this.logger.error('CRITICAL: DAILY_API_KEY is missing from environment variables');
            throw new HttpException('Video service configuration missing', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const roomName = `k12-session-${sessionId}`;
        try {
            this.logger.log(`Attempting to get or update room: ${roomName}`);
            
            // 1. Try to get existing room (most likely scenario)
            let roomData;
            try {
                const getResponse = await axios.get(`${this.apiUrl}/rooms/${roomName}`, {
                    headers: { Authorization: `Bearer ${this.apiKey}` }
                });
                roomData = getResponse.data;
            } catch (err: any) {
                if (err.response?.status === 404) {
                    // 2. Create if doesn't exist
                    this.logger.log(`Room ${roomName} not found, creating new room.`);
                    try {
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
                        // Retry without recording properties (free plan limitation)
                        this.logger.warn(`Room creation failed (possibly plan limitation), retrying without recording: ${createErr.response?.data?.info || createErr.message}`);
                        const fallbackResponse = await axios.post(
                            `${this.apiUrl}/rooms`,
                            {
                                name: roomName,
                                privacy: 'private',
                                properties: {
                                    enable_screenshare: true,
                                    enable_chat: false,
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
                        return fallbackResponse.data;
                    }
                }
                
                // Other GET error (like 401 Unauthorized or 403)
                this.logger.error(`Daily.co API error (GET /rooms/${roomName}):`, err.response?.data || err.message);
                throw err;
            }
            
            // 3. Synchronize properties if room exists
            // We wrap this in a separate try-catch because it might fail if the plan doesn't support 'cloud' recording
            // but we don't want to block the entire session if it's just a property sync failure.
            try {
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
            } catch (syncErr: any) {
                this.logger.warn(`Failed to sync recording properties for room ${roomName} (might be plan limitation):`, syncErr.response?.data || syncErr.message);
                // Continue anyway - joining the session is more important than auto-recording sync
            }

            return roomData;
        } catch (err: any) {
            this.logger.error('Critical failure in DailyService.createRoom:', err.response?.data || err.message);
            throw new HttpException(
                `Failed to initialize video room: ${err.response?.data?.info || 'Daily API Error'}`, 
                err.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async getRecordingAccessLink(recordingId: string): Promise<string> {
        try {
            const response = await axios.get(`${this.apiUrl}/recordings/${recordingId}/access-link`, {
                headers: { Authorization: `Bearer ${this.apiKey}` }
            });
            return response.data.download_link;
        } catch (err: any) {
            this.logger.error('Failed to get access link', err.response?.data || err.message);
            throw new HttpException('Failed to get recording access link', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async createMeetingToken(roomName: string, isOwner: boolean, userName: string): Promise<string> {
        if (!this.apiKey) {
            throw new HttpException('Video service configuration missing', HttpStatus.INTERNAL_SERVER_ERROR);
        }

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
            const errorData = err.response?.data;
            this.logger.error('Daily.co Token creation failed:', errorData || err.message);
            
            // If it failed because of enable_recording: 'cloud' on a free plan, try again without recording
            if (errorData?.info?.includes('recording') || errorData?.error?.includes('recording')) {
                this.logger.warn('Retrying token creation without cloud recording properties...');
                try {
                   const fallbackResponse = await axios.post(
                        `${this.apiUrl}/meeting-tokens`,
                        {
                            properties: {
                                room_name: roomName,
                                is_owner: isOwner,
                                user_name: userName,
                                exp: Math.floor(Date.now() / 1000) + 7200
                            }
                        },
                        { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' } }
                    );
                    return fallbackResponse.data.token;
                } catch (retryErr: any) {
                    this.logger.error('Fallback token creation failed:', retryErr.response?.data || retryErr.message);
                }
            }
            
            throw new HttpException(
                `Failed to generate video access token: ${errorData?.info || 'Daily API Error'}`, 
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}

