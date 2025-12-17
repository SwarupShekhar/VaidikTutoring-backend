import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
@Injectable()
export class DailyService {
    private readonly apiKey = process.env.DAILY_API_KEY;
    private readonly apiUrl = 'https://api.daily.co/v1';
    async createRoom(sessionId: string) {
        const roomName = `k12-session-${sessionId}`;
        try {
            // 1. Try to get existing room (most likely scenario)
            const getResponse = await axios.get(`${this.apiUrl}/rooms/${roomName}`, {
                headers: { Authorization: `Bearer ${this.apiKey}` }
            });
            return getResponse.data;
        } catch (err: any) {
            if (err.response?.status === 404) {
                // 2. Create if doesn't exist
                try {
                    console.log(`[Daily] Creating room: ${roomName}`);
                    const createResponse = await axios.post(
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
                    return createResponse.data;
                } catch (createErr: any) {
                    // CRITICAL: Log the specific error reason from Daily API
                    console.error('[Daily] Room creation failed details:', createErr.response?.data);
                    throw createErr;
                }
            }
            console.error('[Daily] Get room failed:', err.response?.data);
            throw new HttpException('Failed to create video room', HttpStatus.INTERNAL_SERVER_ERROR);
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
                        start_video_off: true,
                        start_audio_off: true,
                        exp: Math.floor(Date.now() / 1000) + 7200
                    }
                },
                { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' } }
            );
            return response.data.token;
        } catch (err: any) {
            console.error('[Daily] Token creation failed:', err.response?.data);
            throw new HttpException('Failed to create token', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
