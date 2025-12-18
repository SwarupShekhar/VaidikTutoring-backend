import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } }) // Root namespace
export class NotificationsGateway implements OnGatewayConnection {
    @WebSocketServer()
    server: Server;

    handleConnection(client: Socket) {
        console.log('Client connected to notifications:', client.id);
    }

    @SubscribeMessage('join_personal_room')
    handleJoinRoom(client: Socket, payload: { userId: string }) {
        client.join(`user-${payload.userId}`);
        console.log(`User ${payload.userId} joined room user-${payload.userId}`);
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
}
