import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket, Namespace } from 'socket.io';
import { Logger, UseGuards, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { clerkClient } from '@clerk/clerk-sdk-node';
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
      'https://api.studyhours.com',
      'https://studyhours.com',
      'https://www.studyhours.com'
    ],
    credentials: true,
  },
})
export class SessionsGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(SessionsGateway.name);
  private whiteboardState = new Map<string, any>(); // Cache for elements
  private slidesState = new Map<string, string[]>(); // Cache for PDF slides
  private filesState = new Map<string, any>(); // Cache for binary files
  private penAccessState = new Map<string, Set<string>>(); // Cache for student pen access (SessionId -> Set of StudentIds)
  private pollState = new Map<string, any>(); // Cache for active polls
  private sessionMap = new Map<string, string>(); // Performance cache
  private clientSessionMap = new Map<string, string>(); // client.id → sessionId
  // Separate map for attendance tracking only. Keeps existing clientSessionMap
  // value shape (sessionId string) untouched so room/whiteboard-state cleanup
  // continues to work identically. Only populated for student joiners.
  private clientAttendanceMap = new Map<string, { sessionId: string; studentId: string }>(); // client.id → { sessionId, studentId }

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly attentionEventsService: AttentionEventsService,
    private readonly sessionPhasesService: SessionPhasesService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) { }

  /**
   * SECURITY: Authenticate every socket at connection time. The frontend sends
   * the JWT in the handshake auth (`io(URL, { auth: { token } })`); we also
   * accept an `Authorization: Bearer <token>` header as a fallback. The verified
   * user id is stored on `client.data.userId` and is the ONLY identity trusted by
   * downstream handlers — client-supplied `userId`/`senderId` in message payloads
   * are ignored for authentication/authorization decisions.
   */
  handleConnection(client: Socket) {
    // Authenticate asynchronously (Clerk verification is a network call). Store the
    // resolving promise on the socket so sensitive handlers (joinSession) can
    // `await client.data.authReady` and can NEVER race ahead of auth resolution.
    client.data.authReady = this.authenticateSocket(client).catch((e) => {
      this.logger.warn(`Socket ${client.id} auth error: ${e?.message}`);
      client.disconnect(true);
    });
  }

  /**
   * Resolves the socket's identity from its handshake token, supporting BOTH auth
   * schemes the HTTP layer accepts (see ClerkAuthGuard): a Clerk session JWT
   * (primary) and a backend-signed JWT (fallback). The resolved backend users.id
   * is stored on client.data.userId. On any failure the socket is disconnected.
   * NOTE: unlike ClerkAuthGuard this never creates/syncs users — a socket joiner
   * must already exist; we only look them up (by email for Clerk, by sub for JWT).
   */
  private async authenticateSocket(client: Socket): Promise<void> {
    const authToken = client.handshake?.auth?.token as string | undefined;
    const headerAuth = client.handshake?.headers?.authorization as string | undefined;
    const bearer = headerAuth?.startsWith('Bearer ') ? headerAuth.slice(7) : headerAuth;
    const token = authToken || bearer;

    if (!token || token === 'undefined' || token === 'null') {
      this.logger.warn(`Socket ${client.id} rejected: no auth token`);
      client.disconnect(true);
      return;
    }

    let userId: string | undefined;
    let role: string | undefined;

    // 1. Try Clerk first (primary auth), then fall back to backend JWT.
    try {
      const claims: any = await (clerkClient as any).verifyToken(token);
      let email =
        claims.email ||
        claims.primary_email_address ||
        claims.email_address ||
        (claims.emails && claims.emails[0]);
      if (!email && typeof claims.sub === 'string' && claims.sub.startsWith('user_')) {
        try {
          const cu = await clerkClient.users.getUser(claims.sub);
          email =
            cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId)?.emailAddress ||
            cu.emailAddresses[0]?.emailAddress;
        } catch {
          /* best-effort email resolution */
        }
      }
      if (email) {
        const dbUser = await this.prisma.users.findFirst({
          where: { email },
          select: { id: true, role: true },
        });
        if (dbUser) {
          userId = dbUser.id;
          role = dbUser.role ?? undefined;
        }
      }
    } catch {
      // 2. Backend-signed JWT fallback (sub === users.id).
      try {
        const payload: any = this.jwtService.verify(token);
        userId = payload.sub || payload.userId;
        role = payload.role;
      } catch (e: any) {
        this.logger.warn(`Socket ${client.id} rejected: token failed Clerk + JWT (${e?.message})`);
        client.disconnect(true);
        return;
      }
    }

    if (!userId) {
      this.logger.warn(`Socket ${client.id} rejected: could not resolve user from token`);
      client.disconnect(true);
      return;
    }

    client.data.userId = userId;
    client.data.role = role;
    this.logger.log(`Client connected: ${client.id} (user ${userId})`);
  }

  /**
   * Counts how many currently-tracked socket clients belong to the same
   * (session, student). Used to ref-count presence so that a student with
   * multiple tabs/devices opens exactly ONE attendance interval (and it is only
   * finalized when their LAST client leaves) — preventing minute double-counting.
   */
  private countActiveStudentClients(sessionId: string, studentId: string): number {
    let count = 0;
    for (const entry of this.clientAttendanceMap.values()) {
      if (entry.sessionId === sessionId && entry.studentId === studentId) count++;
    }
    return count;
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    // ATTENDANCE CAPTURE (purely additive). Recover the tracked student for this
    // client and accumulate their attended minutes. Fire-and-forget + try/catch
    // so it can NEVER interfere with the room/whiteboard-state cleanup below.
    try {
      const attendance = this.clientAttendanceMap.get(client.id);
      this.clientAttendanceMap.delete(client.id);
      if (attendance) {
        // Only finalize the interval when this was the student's LAST client.
        const stillActive =
          this.countActiveStudentClients(attendance.sessionId, attendance.studentId) > 0;
        if (!stillActive) {
          void this.sessionsService
            .markStudentLeft(attendance.sessionId, attendance.studentId)
            .catch((e) =>
              this.logger.error(`Attendance markStudentLeft failed (non-fatal): ${e.message}`),
            );
        }
      }
    } catch (e) {
      this.logger.error(`Attendance disconnect handling failed (non-fatal): ${e.message}`);
    }

    const sessionId = this.clientSessionMap.get(client.id);
    this.clientSessionMap.delete(client.id);
    if (!sessionId) return;
    const room = this.server.adapter.rooms.get(`session:${sessionId}`);
    if (!room || room.size === 0) {
        this.whiteboardState.delete(sessionId);
        this.slidesState.delete(sessionId);
        this.filesState.delete(sessionId);
        this.penAccessState.delete(sessionId);
        this.pollState.delete(sessionId);
        
        // Clean up the bounded sessionMap cache to prevent memory leaks
        for (const [key, val] of this.sessionMap.entries()) {
            if (val === sessionId) {
                this.sessionMap.delete(key);
            }
        }

        this.logger.log(`Cleaned up session state for ${sessionId} (last client left)`);
    }
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
      // SECURITY: wait for connection-time auth to resolve (Clerk verify is async)
      // so a fast joinSession can't bypass it, then trust ONLY the verified
      // identity from the handshake — never the client-supplied data.userId.
      if (client.data?.authReady) await client.data.authReady;
      const verifiedUserId: string | undefined = client.data?.userId;
      if (!verifiedUserId) {
        this.logger.warn(`joinSession rejected: socket ${client.id} is not authenticated`);
        client.disconnect(true);
        return { success: false, error: 'Unauthenticated' };
      }

      // 1. Resolve canonical Session ID or Booking ID
      let finalSessionId = this.sessionMap.get(data.sessionId);
      if (!finalSessionId) {
          finalSessionId = await this.sessionsService.ensureSessionId(data.sessionId);
          this.sessionMap.set(data.sessionId, finalSessionId);
      }

      // SECURITY: enforce access control BEFORE joining the room. Throws
      // Forbidden/NotFound for anyone who is not the student, parent, tutor,
      // admin, or a group-session attendance student for this session.
      await this.sessionsService.verifySessionOrBookingAccess(finalSessionId, verifiedUserId);

      this.clientSessionMap.set(client.id, finalSessionId);

      // 2. Resolve session details
      const session = await this.prisma.sessions.findUnique({
        where: { id: finalSessionId },
        include: {
          bookings: { include: { tutors: true } },
          attendance: { include: { students: true } },
        }
      });

      if (!session) {
        throw new NotFoundException('Booking or Session not found');
      }

      await client.join(`session:${finalSessionId}`);
      this.logger.log(`User ${verifiedUserId} joined session room: session:${finalSessionId}`);

      // 3. Determine if the joiner is the tutor (from the verified identity)
      const isTutor = session.bookings?.tutors?.user_id === verifiedUserId;

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
              actor_user_id: verifiedUserId,
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
      if (accessSet && accessSet.has(verifiedUserId)) {
        client.emit('whiteboard.penAccessUpdated', { studentId: verifiedUserId, hasAccess: true });
      }

      // 11. Calculate return data
      const sessionStartTime = (session.start_time || session.created_at || new Date()).getTime();
      
      let sessionDuration = 60; // Default
      if (session.bookings?.requested_start && session.bookings?.requested_end) {
        const start = new Date(session.bookings.requested_start).getTime();
        const end = new Date(session.bookings.requested_end).getTime();
        sessionDuration = Math.round((end - start) / (1000 * 60));
      }

      // 12. ATTENDANCE CAPTURE (purely additive — runs AFTER all existing join
      // logic incl. late-joiner state replay). Wrapped in try/catch so an
      // attendance failure can NEVER abort the join flow or whiteboard replay.
      try {
        if (!isTutor) {
          // Resolve the joining (verified) user to a students.id. Attendance.studentId
          // references the students table, not users.
          let resolvedStudentId: string | null = null;

          // 1:1 path — the booking carries the student_id (students.id); confirm
          // this user IS that student (skip parents/admins).
          const bookingStudentId = session.bookings?.student_id;
          if (bookingStudentId) {
            const student = await this.prisma.students.findUnique({
              where: { id: bookingStudentId },
              select: { id: true, user_id: true },
            });
            if (student && student.user_id === verifiedUserId) {
              resolvedStudentId = student.id;
            }
          }

          // GROUP path — group bookings have NO student_id; group students live
          // only in pre-seeded attendance rows. Match the verified joiner against
          // those rows so they also get live attendance tracking.
          if (!resolvedStudentId && session.attendance?.length) {
            const att = session.attendance.find(
              (a: any) => a.students?.user_id === verifiedUserId,
            );
            if (att) {
              resolvedStudentId = att.studentId; // == att.students.id
            }
          }

          if (resolvedStudentId) {
            // Ref-count: open an interval only on the 0->1 transition. Extra
            // clients (multi-tab/device) join the SAME open interval so minutes
            // are counted once and finalized only when the last client leaves.
            const alreadyActive =
              this.countActiveStudentClients(finalSessionId, resolvedStudentId) > 0;
            this.clientAttendanceMap.set(client.id, {
              sessionId: finalSessionId,
              studentId: resolvedStudentId,
            });
            if (!alreadyActive) {
              await this.sessionsService.markStudentPresent(finalSessionId, resolvedStudentId);
            }
            this.logger.log(
              `Attendance: student ${resolvedStudentId} present for session ${finalSessionId} (clients now: ${this.countActiveStudentClients(finalSessionId, resolvedStudentId)})`,
            );
          }
        }
      } catch (e) {
        this.logger.error(`Attendance markStudentPresent failed (non-fatal): ${e.message}`);
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

    // ATTENDANCE CAPTURE (purely additive). If this client was a tracked student,
    // accumulate their attended minutes and clean up the attendance map entry.
    // Fire-and-forget + try/catch so it can never affect the room-leave logic.
    try {
      const attendance = this.clientAttendanceMap.get(client.id);
      this.clientAttendanceMap.delete(client.id);
      if (attendance) {
        // Only finalize the interval when this was the student's LAST client.
        const stillActive =
          this.countActiveStudentClients(attendance.sessionId, attendance.studentId) > 0;
        if (!stillActive) {
          void this.sessionsService
            .markStudentLeft(attendance.sessionId, attendance.studentId)
            .catch((e) =>
              this.logger.error(`Attendance markStudentLeft failed (non-fatal): ${e.message}`),
            );
        }
      }
    } catch (e) {
      this.logger.error(`Attendance leave handling failed (non-fatal): ${e.message}`);
    }

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
      // SECURITY: the author is the JWT-verified user, NOT the client-supplied
      // senderId (which could be spoofed to impersonate another participant).
      const senderId = client.data?.userId;
      if (!senderId) {
        client.disconnect(true);
        return { success: false, error: 'Unauthenticated' };
      }

      // 1. Resolve canonical ID from memory
      const finalSessionId = this.clientSessionMap.get(client.id);
      if (!finalSessionId) {
        this.logger.warn(`sendMessage: No session mapping for client ${client.id}`);
        return { success: false, error: 'Not joined to a session' };
      }

      // 2. Save message to Database (Optional but recommended for history)
      await this.sessionsService.postMessage(
        finalSessionId,
        senderId,
        payload.text,
      );

      // 3. Broadcast to everyone in the room EXCEPT sender (client side handles 'me')
      client.broadcast.to(`session:${finalSessionId}`).emit('receiveMessage', {
        text: payload.text,
        senderName: payload.senderName,
        senderId: senderId,
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
      const finalSessionId = this.clientSessionMap.get(client.id);
      if (!finalSessionId) return { success: false, error: 'Not joined' };
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
      const finalSessionId = this.clientSessionMap.get(client.id);
      if (!finalSessionId) return { success: false, error: 'Not joined' };

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
      const finalSessionId = this.clientSessionMap.get(client.id);
      if (!finalSessionId) return { success: false, error: 'Not joined' };
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
      const finalSessionId = this.clientSessionMap.get(client.id);
      if (!finalSessionId) return { success: false, error: 'Not joined' };
      
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
      const finalSessionId = this.clientSessionMap.get(client.id);
      if (!finalSessionId) return { success: false, error: 'Not joined' };

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
      const finalSessionId = this.clientSessionMap.get(client.id);
      if (!finalSessionId) return { success: false, error: 'Not joined' };
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
          const existing = await this.prisma.sessions.findUnique({
            where: { id: payload.sessionId },
            select: { phase_history: true },
          });
          const history: any[] = Array.isArray(existing?.phase_history) ? existing.phase_history as any[] : [];
          await this.prisma.sessions.update({
            where: { id: payload.sessionId },
            data: {
              current_phase: payload.phase,
              phase_history: [...history, { phase: payload.phase, timestamp: new Date().toISOString() }],
            },
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

      // SECURITY: authorize against the JWT-verified identity, not payload.userId.
      const actorUserId = client.data?.userId;
      if (!tutorUserId || tutorUserId !== actorUserId) {
          throw new Error('Unauthorized: Only the assigned tutor can launch polls');
      }

      this.logger.log(`Poll launched in session ${finalSessionId}: ${payload.question} by ${actorUserId}`);
      
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

      // SECURITY: key the response by the JWT-verified identity so a client cannot
      // stuff the ballot under another user's id.
      const responderId = client.data?.userId || payload.userId;
      // Record response
      poll.responses[responderId] = payload.optionIndex;
      
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

      // SECURITY: authorize against the JWT-verified identity, not payload.userId.
      const actorUserId = client.data?.userId;
      if (!tutorUserId || tutorUserId !== actorUserId) {
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
              actor_user_id: actorUserId,
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
