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
    private readonly jitsiDomain = process.env.JITSI_DOMAIN || 'meet.jit.si';
    private readonly jitsiKid = process.env.JITSI_KID || '';

    generateToken(
        userIndex: string, // Unique ID for user
        userName: string,
        userEmail: string,
        userAvatar: string,
        roomName: string,
        isModerator: boolean,
    ): string | null {
        if (!this.appSecret) {
            this.logger.warn('JITSI_APP_SECRET not set. Skipping token generation to avoid invalid auth.');
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        const exp = now + 60 * 60; // 1 hour
        const nbf = now - 10;

        const payload = {
            aud: 'jitsi',
            iss: this.appId, // User said iss must be APP_ID
            sub: this.jitsiDomain, // User said sub must be DOMAIN
            room: roomName,
            iat: now,
            exp: exp,
            nbf: nbf,
            context: {
                user: {
                    id: userIndex,
                    name: userName,
                    email: userEmail,
                    avatar: userAvatar,
                    moderator: isModerator, // boolean true/false
                },
                features: {
                    recording: false,
                    livestreaming: false,
                    transcription: false,
                },
            },
        };

        const options: jwt.SignOptions = {
            algorithm: 'HS256',
            header: {
                alg: 'HS256',
                typ: 'JWT',
                kid: this.jitsiKid, // User said kid is required in header
            },
        };

        return jwt.sign(payload, this.appSecret, options);
    }
}
