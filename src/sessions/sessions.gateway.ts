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
import { AttentionEventsService } from '../attention-events/attention-events.service.js';
import { SessionPhasesService } from '../session-phases/session-phases.service.js';
import { AttentionEventType, SessionPhase } from '../../generated/prisma/enums.js';

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
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  },
})
export class SessionsGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SessionsGateway.name);

  constructor(
    private sessionsService: SessionsService,
    private attentionEventsService: AttentionEventsService,
    private sessionPhasesService: SessionPhasesService,
  ) { }

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
      await this.sessionsService.verifySessionAccess(
        data.sessionId,
        data.userId,
      );

      client.join(`session-${data.sessionId}`);
      this.logger.log(`Client ${client.id} joined session-${data.sessionId}`);

      return { success: true, message: 'Joined session successfully' };
    } catch (error) {
      this.logger.error(`Failed to join session: ${error.message}`);
      // Security: Disconnect unauthorized client
      client.disconnect(true);
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
    @MessageBody() payload: { sessionId: string; text: string; senderName: string; senderId: string },
  ) {
    try {
      // 1. Save message to Database (Optional but recommended for history)
      // Note: postMessage expects userId, text. We use senderId from payload.
      await this.sessionsService.postMessage(
        payload.sessionId,
        payload.senderId,
        payload.text,
      );

      // 2. Broadcast to everyone in the room EXCEPT sender (client side handles 'me')
      client.broadcast.to(`session-${payload.sessionId}`).emit('receiveMessage', {
        text: payload.text,
        senderName: payload.senderName,
        senderId: payload.senderId,
        timestamp: new Date(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Log an attention event in real-time
   */
  @SubscribeMessage('session.attentionEvent.create')
  async handleAttentionEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      sessionId: string;
      type: AttentionEventType;
      studentId: string;
      tutorId: string;
      metadata?: any
    },
  ) {
    try {
      // 1. Persist event
      const event = await this.attentionEventsService.createEvent(payload);

      // 2. Broadcast update to the room
      this.server.to(`session-${payload.sessionId}`).emit('session.attentionEvent.created', event);

      // 3. Also emit updated summary
      const summary = await this.attentionEventsService.getSummary(payload.sessionId);
      this.server.to(`session-${payload.sessionId}`).emit('session.attentionSummary.updated', summary);

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to log attention event: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update session phase in real-time
   */
  @SubscribeMessage('session.phase.update')
  async handlePhaseUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      sessionId: string;
      phase: SessionPhase;
    },
  ) {
    try {
      // 1. Update Phase
      await this.sessionPhasesService.advancePhase(payload.sessionId, payload.phase);

      // 2. Broadcast to everyone
      this.server.to(`session-${payload.sessionId}`).emit('session.phase.updated', {
        phase: payload.phase,
        timestamp: new Date()
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to update phase: ${error.message}`);
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
