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
import { Logger, UseGuards, NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { AttentionEventsService } from '../attention-events/attention-events.service';
import { SessionPhasesService } from '../session-phases/session-phases.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttentionEventType, SessionPhase } from '@prisma/client';

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
  private whiteboardState = new Map<string, any>(); // Cache for elements
  private slidesState = new Map<string, string[]>(); // Cache for PDF slides
  private filesState = new Map<string, any>(); // Cache for binary files
  private penAccessState = new Map<string, Set<string>>(); // Cache for student pen access (SessionId -> Set of StudentIds)
  private pollState = new Map<string, any>(); // Cache for active polls
  private sessionMap = new Map<string, string>(); // Performance cache

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
      // 1. Resolve canonical Session ID or Booking ID
      let finalSessionId = this.sessionMap.get(data.sessionId);
      if (!finalSessionId) {
          finalSessionId = await this.sessionsService.ensureSessionId(data.sessionId);
          this.sessionMap.set(data.sessionId, finalSessionId);
      }

      // 2. Resolve session details
      const session = await this.prisma.sessions.findUnique({
        where: { id: finalSessionId },
        include: { bookings: { include: { tutors: true } } }
      });

      if (!session) {
        throw new NotFoundException('Booking or Session not found');
      }

      await client.join(`session:${finalSessionId}`);
      this.logger.log(`User ${data.userId} joined session room: session:${finalSessionId}`);

      // 3. Determine if the joiner is the tutor
      const isTutor = session.bookings?.tutors?.user_id === data.userId;

      // 4. GAP FIX: Update session status to 'in_progress' if the tutor joins a 'scheduled' session
      if (isTutor && session.status === 'scheduled') {
        await this.prisma.sessions.update({
          where: { id: finalSessionId },
          data: { status: 'in_progress' }
        });
        this.logger.log(`Session ${finalSessionId} marked in_progress (tutor joined)`);
        session.status = 'in_progress'; // Update local object for return
      }

      // 5. Audit join for activity pulse
      try {
          await this.prisma.audit_logs.create({
            data: {
              action: 'SESSION_JOINED',
              actor_user_id: data.userId,
              details: { sessionId: finalSessionId, isTutor }
            }
          });
      } catch (e) { /* ignore */ }

      // 7. Handle whiteboard state for late joiners
      const lastUpdate = this.whiteboardState.get(finalSessionId);
      if (lastUpdate) {
        client.emit('whiteboard.receiveUpdate', lastUpdate);
      }

      // 8. Handle slides state for late joiners
      const slidesArray = this.slidesState.get(finalSessionId);
      if (slidesArray) {
        client.emit('whiteboard.receiveSlides', slidesArray);
      }

      // 9. Handle files state for late joiners
      const files = this.filesState.get(finalSessionId);
      if (files) {
        client.emit('whiteboard.receiveFiles', files);
      }

      // 10. Handle active poll state for late joiners
      const poll = this.pollState.get(finalSessionId);
      if (poll && poll.active) {
        client.emit('poll:launched', {
          question: poll.question,
          options: poll.options
        });

        // If the joiner is the tutor, also send current live results
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

      // 10. Handle pen access for late joiners
      const accessSet = this.penAccessState.get(finalSessionId);
      if (accessSet && accessSet.has(data.userId)) {
        client.emit('whiteboard.penAccessUpdated', { studentId: data.userId, hasAccess: true });
      }

      // 11. Calculate return data
      const sessionStartTime = (session.start_time || session.created_at || new Date()).getTime();
      
      let sessionDuration = 60; // Default
      if (session.bookings?.requested_start && session.bookings?.requested_end) {
        const start = new Date(session.bookings.requested_start).getTime();
        const end = new Date(session.bookings.requested_end).getTime();
        sessionDuration = Math.round((end - start) / (1000 * 60));
      }

      return { 
        success: true, 
        sessionId: finalSessionId,
        sessionStartTime,
        sessionDuration
      };
    } catch (error) {
      this.logger.error(`Failed to join session: ${error.message}`);
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
      client.leave(`session:${finalSessionId}`);
      this.logger.log(`Client ${client.id} left session:${finalSessionId}`);
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
      client.broadcast.to(`session:${finalSessionId}`).emit('receiveMessage', {
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
      const finalSessionId = this.sessionMap.get(payload.sessionId) || payload.sessionId;
      const payloadSize = JSON.stringify(payload.update).length / 1024; // in KB
      
      this.logger.debug(`Whiteboard update for ${finalSessionId}: ${payloadSize.toFixed(2)} KB`);

      // Strip files from regular updates to reduce payload size
      // Only elements are needed for real-time stroke sync
      const strippedUpdate = { ...payload.update };
      if (strippedUpdate.files) {
        delete strippedUpdate.files;
      }

      this.whiteboardState.set(finalSessionId, strippedUpdate);
      client.broadcast.to(`session:${finalSessionId}`).emit('whiteboard.receiveUpdate', strippedUpdate);
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
      const finalSessionId = this.sessionMap.get(payload.sessionId) || payload.sessionId;

      // Update cache
      let currentFiles = this.filesState.get(finalSessionId) || {};
      currentFiles = { ...currentFiles, ...payload.files };
      this.filesState.set(finalSessionId, currentFiles);

      // Broadcast heavy binary data
      this.logger.log(`Syncing ${Object.keys(payload.files || {}).length} files for session ${finalSessionId}`);
      client.broadcast.to(`session:${finalSessionId}`).emit('whiteboard.receiveFiles', payload.files);
      return { success: true };
    } catch (error) {
      this.logger.error(`File sync failed: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Sync complete slide library (PNG arrays)
   */
  @SubscribeMessage('whiteboard.syncSlides')
  async handleWhiteboardSyncSlides(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; slides: string[] },
  ) {
    try {
      const finalSessionId = this.sessionMap.get(payload.sessionId) || payload.sessionId;
      const slideCount = payload.slides?.length || 0;
      const totalSize = JSON.stringify(payload.slides).length / (1024 * 1024); // in MB
      
      this.logger.log(`Syncing ${slideCount} slides for session ${finalSessionId} (${totalSize.toFixed(2)} MB)`);
      
      this.slidesState.set(finalSessionId, payload.slides);
      client.broadcast.to(`session:${finalSessionId}`).emit('whiteboard.receiveSlides', payload.slides);
      return { success: true };
    } catch (error) {
      this.logger.error(`Whiteboard slide sync failed: ${error.message}`);
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
      const finalSessionId = this.sessionMap.get(payload.sessionId) || payload.sessionId;
      
      // Update cache
      let accessSet = this.penAccessState.get(finalSessionId);
      if (!accessSet) {
        accessSet = new Set<string>();
        this.penAccessState.set(finalSessionId, accessSet);
      }

      if (payload.hasAccess) {
        accessSet.add(payload.studentId);
      } else {
        accessSet.delete(payload.studentId);
      }

      client.broadcast.to(`session:${finalSessionId}`).emit('whiteboard.penAccessUpdated', {
        studentId: payload.studentId,
        hasAccess: payload.hasAccess,
      });
      return { success: true };
    } catch (error) {
      this.logger.error(`Pen access toggle failed: ${error.message}`);
      return { success: false };
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

      client.broadcast.to(`session:${finalSessionId}`).emit('whiteboard.confettiFired');
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
    @MessageBody() payload: { sessionId: string; userId: string; username: string; pointer: any; button: string; selectedElementIds: any[]; isLaserActive?: boolean },
  ) {
    try {
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      client.broadcast.to(`session:${finalSessionId}`).emit('whiteboard.pointerUpdate', payload);
      return { success: true };
    } catch (error) {
      this.logger.error(`Whiteboard pointer update failed: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Give Sticker Reward
   */
  @SubscribeMessage('sticker:give')
  async handleStickerGive(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; studentId: string; stickerType: string; studentName: string },
  ) {
    try {
      const finalSessionId = await this.sessionsService.ensureSessionId(payload.sessionId);

      // We need to resolve the student profile to a User ID because sticker_rewards table
      // currently incorrectly references the users table's ID.
      const studentProfile = await this.prisma.students.findUnique({
        where: { id: payload.studentId },
        select: { user_id: true, parent_user_id: true }
      });

      const studentUserId = studentProfile?.user_id || studentProfile?.parent_user_id;

      if (!studentUserId) {
          this.logger.warn(`Could not resolve a User ID for student profile ${payload.studentId}`);
      }

      // Persist to DB
      await this.prisma.sticker_rewards.create({
        data: {
          session_id: finalSessionId,
          student_id: studentUserId || payload.studentId, // Fallback to raw ID (might fail FK if not resolved)
          sticker: payload.stickerType,
        }
      });

      // Broadcast to room
      this.server.to(`session:${finalSessionId}`).emit('sticker:received', {
        stickerType: payload.stickerType,
        studentName: payload.studentName
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to give sticker: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync Viewport (Tutor to Students)
   */
  @SubscribeMessage('viewport:sync')
  async handleViewportSync(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; centerX: number; centerY: number; zoom: number },
  ) {
    try {
      const finalSessionId = this.sessionMap.get(payload.sessionId) || payload.sessionId;

      // Broadcast to everyone ELSE in the room (the students)
      client.broadcast.to(`session:${finalSessionId}`).emit('viewport:update', {
        centerX: payload.centerX,
        centerY: payload.centerY,
        zoom: payload.zoom
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Viewport sync failed: ${error.message}`);
      return { success: false };
    }
  }

  /**
   * Handle Whiteboard Sync Request (student requests current state from tutor)
   */
  @SubscribeMessage('whiteboard.requestSync')
  handleWhiteboardRequestSync(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string },
  ) {
    try {
      const finalSessionId = this.sessionMap.get(payload.sessionId) || payload.sessionId;
      // Broadcast sync request to the room so tutor responds
      client.broadcast.to(`session:${finalSessionId}`).emit('whiteboard.syncRequest');
      return { success: true };
    } catch (error) {
      this.logger.error(`Whiteboard sync request failed: ${error.message}`);
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

      client.broadcast.to(`session:${finalSessionId}`).emit('whiteboard.slideChanged', { index: payload.index });
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

      client.broadcast.to(`session:${finalSessionId}`).emit('session.reaction', {
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
      this.server.to(`session:${payload.sessionId}`).emit('session.attentionEvent.created', event);
      const summary = await this.attentionEventsService.getSummary(payload.sessionId);
      this.server.to(`session:${payload.sessionId}`).emit('session.attentionSummary.updated', summary);

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
      
      // GAP FIX: Persist phase to database for state recovery on participant refresh
      try {
          await this.prisma.sessions.update({
            where: { id: payload.sessionId },
            data: { 
              current_phase: payload.phase,
              // Optionally append to history log
              phase_history: {
                push: { phase: payload.phase, timestamp: new Date() }
              }
            }
          });
      } catch (e) {
          this.logger.error(`Failed to persist phase update: ${e.message}`);
      }

      console.log(`[Phase] Updated to ${payload.phase} for session ${payload.sessionId}`);

      // 2. Broadcast to everyone
      this.server.to(`session:${payload.sessionId}`).emit('session.phase.updated', {
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
    this.server.to(`session:${sessionId}`).emit('newMessage', message);
  }

  /**
   * Emit a new recording event to all clients in a session
   */
  emitNewRecording(sessionId: string, recording: any) {
    this.server.to(`session:${sessionId}`).emit('newRecording', recording);
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
      // 1. Resolve canonical ID
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      // Role verification: Only the assigned tutor can launch polls
      const session = await this.prisma.sessions.findUnique({
        where: { id: finalSessionId },
        include: { bookings: { include: { tutors: true } } }
      });

      const tutorUserId = session?.bookings?.tutors?.user_id;

      if (!tutorUserId || tutorUserId !== payload.userId) {
          throw new Error('Unauthorized: Only the assigned tutor can launch polls');
      }

      this.logger.log(`Poll launched in session ${finalSessionId}: ${payload.question} by ${payload.userId}`);
      
      const poll = {
        question: payload.question,
        options: payload.options,
        responses: {}, // userId -> optionIndex
        active: true,
        startTime: Date.now()
      };
      
      this.pollState.set(finalSessionId, poll);
      
      // Broadcast to everyone that a poll has started
      this.server.to(`session:${finalSessionId}`).emit('poll:launched', {
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
      // Resolve canonical ID
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      const poll = this.pollState.get(finalSessionId);
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
      this.server.to(`session:${finalSessionId}`).emit('poll:results', {
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
      // 1. Resolve canonical ID
      let finalSessionId = payload.sessionId;
      const booking = await this.sessionsService.resolveBookingToSession(payload.sessionId);
      if (booking && booking.sessions.length > 0) {
        finalSessionId = booking.sessions[0].id;
      }

      // Role verification: Only the assigned tutor can close polls
      const session = await this.prisma.sessions.findUnique({
        where: { id: finalSessionId },
        include: { bookings: { include: { tutors: true } } }
      });

      const tutorUserId = session?.bookings?.tutors?.user_id;

      if (!tutorUserId || tutorUserId !== payload.userId) {
          throw new Error('Unauthorized: Only the assigned tutor can close polls');
      }

      const poll = this.pollState.get(finalSessionId);
      if (!poll) return { success: false, error: 'No poll to close' };

      poll.active = false;
      
      // Final results breakdown
      const results = poll.options.map((_: any, idx: number) => {
        return Object.values(poll.responses).filter(v => v === idx).length;
      });

      // GAP FIX: Persist poll results to Audit Logs for session reporting
      try {
          await this.prisma.audit_logs.create({
            data: {
              action: 'SESSION_POLL_COMPLETED',
              actor_user_id: payload.userId,
              details: {
                sessionId: finalSessionId,
                question: poll.question,
                options: poll.options,
                results,
                totalResponses: Object.keys(poll.responses).length
              }
            }
          });
      } catch (e) {
          this.logger.error(`Failed to audit poll completion: ${e.message}`);
      }

      // Broadcast final results to EVERYONE
      this.server.to(`session:${finalSessionId}`).emit('poll:closed', {
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
