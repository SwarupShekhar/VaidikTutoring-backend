import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class DailyService {
    private readonly logger = new Logger(DailyService.name);
    private readonly apiKey = process.env.DAILY_API_KEY;
    private readonly apiUrl = 'https://api.daily.co/v1';

    /**
     * Creates a Daily.co room for a session or retrieves existing one
     * @param sessionId - Unique session identifier
     * @returns Room object with name and url
     */
    async createRoom(sessionId: string) {
        if (!this.apiKey) {
            this.logger.error('DAILY_API_KEY not configured');
            throw new Error('Daily.co API key not configured');
        }

        const roomName = `k12-session-${sessionId}`;

        try {
            // Check if room already exists
            const existingRoom = await this.getRoom(roomName);
            if (existingRoom) {
                this.logger.log(`Room already exists: ${roomName}`);
                return existingRoom;
            }
        } catch (error) {
            // Room doesn't exist, continue to create
        }

        try {
            // Create new room with 2-hour expiration
            const response = await axios.post(
                `${this.apiUrl}/rooms`,
                {
                    name: roomName,
                    privacy: 'private',
                    properties: {
                        exp: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
                        enable_chat: true,
                        enable_screenshare: true,
                        enable_recording: 'cloud',
                        start_video_off: false,
                        start_audio_off: false,
                    },
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            this.logger.log(`Created Daily.co room: ${roomName}`);
            return {
                name: response.data.name,
                url: response.data.url,
            };
        } catch (error) {
            this.logger.error(`Failed to create Daily.co room: ${error.message}`);
            throw new Error('Failed to create video room');
        }
    }

    /**
     * Retrieves an existing Daily.co room
     * @param roomName - Name of the room
     * @returns Room object or null if not found
     */
    private async getRoom(roomName: string) {
        try {
            const response = await axios.get(
                `${this.apiUrl}/rooms/${roomName}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                    },
                }
            );

            return {
                name: response.data.name,
                url: response.data.url,
            };
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Creates a meeting token for a user to join a Daily.co room
     * @param roomName - Name of the room
     * @param isOwner - Whether user should have owner privileges (tutor/admin)
     * @param userName - Display name for the user
     * @returns Meeting token string
     */
    async createMeetingToken(
        roomName: string,
        isOwner: boolean,
        userName: string
    ): Promise<string> {
        if (!this.apiKey) {
            this.logger.error('DAILY_API_KEY not configured');
            throw new Error('Daily.co API key not configured');
        }

        try {
            const response = await axios.post(
                `${this.apiUrl}/meeting-tokens`,
                {
                    properties: {
                        room_name: roomName,
                        is_owner: isOwner,
                        user_name: userName,
                        enable_recording: isOwner ? 'cloud' : false,
                        start_cloud_recording: false,
                        exp: Math.floor(Date.now() / 1000) + 7200, // 2 hours
                    },
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            this.logger.log(`Created meeting token for ${userName} (owner: ${isOwner})`);
            return response.data.token;
        } catch (error) {
            this.logger.error(`Failed to create meeting token: ${error.message}`);
            throw new Error('Failed to create meeting token');
        }
    }
}
