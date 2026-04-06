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
import { PrismaService } from '../prisma/prisma.service';
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
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'https://k-12-backend-vnp4.vercel.app',
      'https://k-12-vaidik.vercel.app',
      'https://vaidiktutoring.vercel.app',
      'https://k-12-backend.onrender.com',
      'https://studyhours.com',
      'https://www.studyhours.com'
    ],
    credentials: true,
  },
})
export class SessionsGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SessionsGateway.name);
  private whiteboardState = new Map<string, any>(); // Cache for late joiners (SessionId -> Elements)
  private pollState = new Map<string, any>(); // Cache for active polls { question, options, responses: {}, active: true }

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly attentionEventsService: AttentionEventsService,
    private readonly sessionPhasesService: SessionPhasesService,
    private readonly prisma: PrismaService,
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
      // Verify user has access to this session or booking
      // Resolve canonical Session ID to ensure everyone is in the same room
      let finalSessionId = data.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(data.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      await client.join(`session-${finalSessionId}`);
      this.logger.log(`User ${data.userId} joined session room: session-${finalSessionId}`);

      // 1. Sync active poll state for late joiners
      const poll = this.pollState.get(finalSessionId);
      if (poll && poll.active) {
        client.emit('poll:launched', {
          question: poll.question,
          options: poll.options
        });

        // 2. If the joiner is the tutor, also send current live results
        const booking = await this.sessionsService.resolveBookingToSession(data.sessionId);
        // We need to find the session to get the tutor info if resolveBooking failed
        let isTutor = false;
        if (booking && booking.assigned_tutor_id) {
          const tutor = await this.prisma.tutors.findUnique({ where: { id: booking.assigned_tutor_id } });
          if (tutor && tutor.user_id === data.userId) isTutor = true;
        } else {
          // Try resolving via session ID directly
          const session = await this.prisma.sessions.findUnique({
            where: { id: finalSessionId },
            include: { bookings: { include: { tutors: true } } }
          });
          if (session?.bookings?.tutors?.user_id === data.userId) isTutor = true;
        }

        if (isTutor) {
          const results = poll.options.map((_: any, idx: number) => {
            return Object.values(poll.responses).filter(v => v === idx).length;
          });
          client.emit('poll:results', {
            results,
            totalResponses: Object.keys(poll.responses).length
          });
        }
      }

      return { success: true, sessionId: finalSessionId };
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
    let finalSessionId = data.sessionId;
    // Resolve for consistency
    this.sessionsService.resolveBookingToSession(data.sessionId).then(booking => {
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }
      client.leave(`session-${finalSessionId}`);
      this.logger.log(`Client ${client.id} left session-${finalSessionId}`);
    });
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
      // 1. Resolve canonical ID
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      // 2. Save message to Database (Optional but recommended for history)
      await this.sessionsService.postMessage(
        finalSessionId,
        payload.senderId,
        payload.text,
      );

      // 3. Broadcast to everyone in the room EXCEPT sender (client side handles 'me')
      client.broadcast.to(`session-${finalSessionId}`).emit('receiveMessage', {
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
   * Sync Whiteboard data (Elements only for performance)
   */
  @SubscribeMessage('whiteboard.update')
  async handleWhiteboardUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; update: any },
  ) {
    try {
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      // Strip files from regular updates to reduce payload size
      // Only elements are needed for real-time stroke sync
      const strippedUpdate = { ...payload.update };
      if (strippedUpdate.files) {
        delete strippedUpdate.files;
      }

      this.whiteboardState.set(finalSessionId, strippedUpdate);
      client.broadcast.to(`session-${finalSessionId}`).emit('whiteboard.receiveUpdate', strippedUpdate);
      return { success: true };
    } catch (error) {
      this.logger.error(`Whiteboard sync failed: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Specialized sync for large binary files (Images/PDFs)
   */
  @SubscribeMessage('whiteboard.syncFiles')
  async handleWhiteboardSyncFiles(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; files: any },
  ) {
    try {
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      // Broadcast heavy binary data
      this.logger.log(`Syncing ${Object.keys(payload.files || {}).length} files for session ${finalSessionId}`);
      client.broadcast.to(`session-${finalSessionId}`).emit('whiteboard.receiveFiles', payload.files);
      return { success: true };
    } catch (error) {
      this.logger.error(`Whiteboard file sync failed: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Toggle student pen access
   */
  @SubscribeMessage('whiteboard.togglePenAccess')
  async handleTogglePenAccess(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; studentId: string; hasAccess: boolean },
  ) {
    try {
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      client.broadcast.to(`session-${finalSessionId}`).emit('whiteboard.penAccessUpdated', {
        studentId: payload.studentId,
        hasAccess: payload.hasAccess
      });
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to toggle pen access: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger Confetti
   */
  @SubscribeMessage('whiteboard.triggerConfetti')
  async handleTriggerConfetti(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string },
  ) {
    try {
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      client.broadcast.to(`session-${finalSessionId}`).emit('whiteboard.confettiFired');
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to trigger confetti: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Collaborative Cursor Update
   */
  @SubscribeMessage('whiteboard.pointerUpdate')
  async handleWhiteboardPointerUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; userId: string; username: string; pointer: any; button: string; selectedElementIds: any[] },
  ) {
    try {
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      client.broadcast.to(`session-${finalSessionId}`).emit('whiteboard.pointerUpdate', payload);
      return { success: true };
    } catch (error) {
      this.logger.error(`Whiteboard pointer update failed: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Whiteboard Slide Change
   */
  @SubscribeMessage('whiteboard.slideChange')
  async handleWhiteboardSlideChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; index: number },
  ) {
    try {
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      client.broadcast.to(`session-${finalSessionId}`).emit('whiteboard.slideChanged', { index: payload.index });
      return { success: true };
    } catch (error) {
      this.logger.error(`Slide change sync failed: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Trigger reaction emojis
   */
  @SubscribeMessage('session.reaction')
  async handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; emoji: string },
  ) {
    try {
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      client.broadcast.to(`session-${finalSessionId}`).emit('session.reaction', {
        emoji: payload.emoji
      });
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to trigger reaction: ${error.message}`);
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

  /**
   * Tutor launches a poll
   */
  @SubscribeMessage('poll:launch')
  async handlePollLaunch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; question: string; options: string[]; userId: string },
  ) {
    try {
      // Role verification: Only the assigned tutor can launch polls
      const session = await this.prisma.sessions.findUnique({
        where: { id: payload.sessionId },
        include: { bookings: { include: { tutors: true } } }
      });

      const tutorUserId = session?.bookings?.tutors?.user_id;

      if (!tutorUserId || tutorUserId !== payload.userId) {
          throw new Error('Unauthorized: Only the assigned tutor can launch polls');
      }

      this.logger.log(`Poll launched in session ${payload.sessionId}: ${payload.question} by ${payload.userId}`);
      
      const poll = {
        question: payload.question,
        options: payload.options,
        responses: {}, // userId -> optionIndex
        active: true,
        startTime: Date.now()
      };
      
      this.pollState.set(payload.sessionId, poll);
      
      // Broadcast to everyone that a poll has started
      this.server.to(`session-${payload.sessionId}`).emit('poll:launched', {
        question: payload.question,
        options: payload.options
      });
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to launch poll: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Student responds to a poll
   */
  @SubscribeMessage('poll:respond')
  async handlePollRespond(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; userId: string; optionIndex: number },
  ) {
    try {
      const poll = this.pollState.get(payload.sessionId);
      if (!poll || !poll.active) {
        return { success: false, error: 'No active poll found' };
      }

      // Record response
      poll.responses[payload.userId] = payload.optionIndex;
      
      // Calculate results for tutor
      const results = poll.options.map((_: any, idx: number) => {
        return Object.values(poll.responses).filter(v => v === idx).length;
      });

      // Broadcast results TO TUTOR ONLY
      // NOTE: In a true production app, we should target only tutors' socket.id.
      // For simplicity in this in-memory feature, we emit 'poll:results' to the room,
      // and the frontend will ensure only tutors respond/display this UI.
      this.server.to(`session-${payload.sessionId}`).emit('poll:results', {
        results,
        totalResponses: Object.keys(poll.responses).length
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to record poll response: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Tutor closes a poll
   */
  @SubscribeMessage('poll:close')
  async handlePollClose(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; userId: string },
  ) {
    try {
      // Role verification: Only the assigned tutor can close polls
      const session = await this.prisma.sessions.findUnique({
        where: { id: payload.sessionId },
        include: { bookings: { include: { tutors: true } } }
      });

      const tutorUserId = session?.bookings?.tutors?.user_id;

      if (!tutorUserId || tutorUserId !== payload.userId) {
          throw new Error('Unauthorized: Only the assigned tutor can close polls');
      }

      const poll = this.pollState.get(payload.sessionId);
      if (!poll) return { success: false, error: 'No poll to close' };

      poll.active = false;
      
      // Final results breakdown
      const results = poll.options.map((_: any, idx: number) => {
        return Object.values(poll.responses).filter(v => v === idx).length;
      });

      // Broadcast final results to EVERYONE
      this.server.to(`session-${payload.sessionId}`).emit('poll:closed', {
        question: poll.question,
        options: poll.options,
        results,
        totalResponses: Object.keys(poll.responses).length
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to close poll: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
