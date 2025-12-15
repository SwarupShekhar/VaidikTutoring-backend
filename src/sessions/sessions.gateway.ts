import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { SessionsService } from './sessions.service';

/**
 * WebSocket Gateway for real-time session chat
 * 
 * Client Usage:
 * 1. Connect to ws://localhost:3000/sessions
 * 2. Emit 'joinSession' with { sessionId: 'xxx', token: 'jwt-token' }
 * 3. Listen for 'newMessage' events
 * 4. Emit 'sendMessage' with { sessionId: 'xxx', text: 'message' }
 */
@WebSocketGateway({
    namespace: 'sessions',
    cors: {
        origin: '*', // Configure this for your frontend URL in production
        credentials: true,
    },
})
export class SessionsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(SessionsGateway.name);

    constructor(private sessionsService: SessionsService) {}

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    /**
     * Client joins a session room for real-time updates
     */
    @SubscribeMessage('joinSession')
    async handleJoinSession(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { sessionId: string; userId: string },
    ) {
        try {
            // Verify user has access to this session
            await this.sessionsService['verifySessionAccess'](data.sessionId, data.userId);
            
            client.join(`session-${data.sessionId}`);
            this.logger.log(`Client ${client.id} joined session-${data.sessionId}`);
            
            return { success: true, message: 'Joined session successfully' };
        } catch (error) {
            this.logger.error(`Failed to join session: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Client leaves a session room
     */
    @SubscribeMessage('leaveSession')
    handleLeaveSession(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { sessionId: string },
    ) {
        client.leave(`session-${data.sessionId}`);
        this.logger.log(`Client ${client.id} left session-${data.sessionId}`);
        return { success: true };
    }

    /**
     * Send a message in real-time
     */
    @SubscribeMessage('sendMessage')
    async handleSendMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { sessionId: string; userId: string; text: string },
    ) {
        try {
            const message = await this.sessionsService.postMessage(
                data.sessionId,
                data.userId,
                data.text,
            );

            // Broadcast to all clients in the session room
            this.server.to(`session-${data.sessionId}`).emit('newMessage', message);

            return { success: true, message };
        } catch (error) {
            this.logger.error(`Failed to send message: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Emit a new message event to all clients in a session
     * This can be called from the service or controller
     */
    emitNewMessage(sessionId: string, message: any) {
        this.server.to(`session-${sessionId}`).emit('newMessage', message);
    }

    /**
     * Emit a new recording event to all clients in a session
     */
    emitNewRecording(sessionId: string, recording: any) {
        this.server.to(`session-${sessionId}`).emit('newRecording', recording);
    }
}
