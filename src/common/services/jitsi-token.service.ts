import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JitsiTokenService {
    private readonly logger = new Logger(JitsiTokenService.name);

    // These should ideally come from environment variables.
    // If using public meet.jit.si (free), these might not be strictly enforced unless using a paid plan, 
    // but for self-hosted or configured instances, they are critical.
    private readonly appId = process.env.JITSI_APP_ID || '';
    private readonly appSecret = process.env.JITSI_APP_SECRET || '';

    generateToken(
        userIndex: string, // Unique ID for user
        userName: string,
        userEmail: string,
        userAvatar: string,
        roomName: string,
        isModerator: boolean,
    ): string {
        // If no secret provided, we can't sign a valid token for a secured instance.
        // However, if the user is using the free public instance without config, a generic token *might* not help 
        // unless the room is claimed. But assuming standard Jitsi token auth structure:

        if (!this.appSecret) {
            this.logger.warn('JITSI_APP_SECRET not set. Token generation might fail validation on server.');
        }

        const now = Math.floor(Date.now() / 1000);
        const exp = now + 7200; // 2 hours
        const nbf = now - 10;

        const payload = {
            aud: 'jitsi',
            iss: this.appId || 'chat', // 'chat' is often default for meet.jit.si
            sub: '*', // room wildcard or specific
            room: '*',
            iat: now,
            exp: exp,
            nbf: nbf,
            context: {
                user: {
                    id: userIndex,
                    name: userName,
                    email: userEmail,
                    avatar: userAvatar,
                    moderator: isModerator ? 'true' : 'false',
                },
                features: {
                    recording: 'true',
                    livestreaming: 'true',
                    screenSharing: 'true',
                },
            },
        };

        // If using the public free meet.jit.si, the secret is usually not shared/known.
        // BUT, the "wait for moderator" behavior implies the room IS secured or expects auth.
        // We sign with the provided secret.
        return jwt.sign(payload, this.appSecret || 'secret');
    }
}
