import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
    cors: {
        origin: [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:3002',
            'https://studyhours.com',           // Production frontend
            'https://www.studyhours.com',       // Production with www
            'https://k-12-backend-vnp4.vercel.app',
            'https://k-12-vaidik.vercel.app',
            'https://vaidiktutoring.vercel.app',
            'https://k-12-backend.onrender.com'
        ],
        credentials: true
    }
}) // Root namespace
export class NotificationsGateway implements OnGatewayConnection {
    private readonly logger = new Logger(NotificationsGateway.name);

    @WebSocketServer()
    server: Server;

    handleConnection(client: Socket) {
        this.logger.debug(`Client connected to notifications: ${client.id}`);
    }

    @SubscribeMessage('join_personal_room')
    handleJoinRoom(client: Socket, payload: { userId: string }) {
        if (payload.userId) {
            client.join(`user-${payload.userId}`);
            this.logger.debug(`User ${payload.userId} joined notification room: user-${payload.userId}`);
        }
    }

    // Call this method from your BookingsService
    notifyAdminBooking(studentName: string) {
        this.server.emit('booking:created', { studentName });
    }

    notifyStudentAllocation(userId: string, tutorName: string) {
        this.server.to(`user-${userId}`).emit('booking:allocated', { tutorName });
    }

    notifyTutorAllocation(userId: string, studentName: string, scheduledTime: string) {
        this.server.to(`user-${userId}`).emit('booking:assigned_to_me', { studentName, scheduledTime });
    }

    notifyParentSessionNote(userId: string, childId: string, tutorName: string) {
        this.server.to(`user-${userId}`).emit('session:note_added', { childId, tutorName });
    }

    notifyAdminSupport(ticketId: string, userName: string, message: string) {
        // Broadcast to all connected clients in the admin room
        this.server.to('room:admins').emit('support:new_ticket', { ticketId, userName, message });
    }

    notifyAdmin(event: string, payload: any) {
        this.server.to('room:admins').emit(event, payload);
    }

    @SubscribeMessage('join_admin_room')
    handleJoinAdminRoom(client: Socket, payload: { role: string }) {
        if (payload.role === 'admin') {
            client.join('room:admins');
            this.logger.debug(`Admin client ${client.id} joined admin room`);
        }
    }
}
