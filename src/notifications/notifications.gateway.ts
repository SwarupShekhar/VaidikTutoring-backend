import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
    namespace: 'notifications',
    cors: {
        origin: '*', // Configure for production
        credentials: true,
    },
})
export class NotificationsGateway
    implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(NotificationsGateway.name);

    handleConnection(client: Socket) {
        this.logger.log(`Notification Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Notification Client disconnected: ${client.id}`);
    }

    /**
     * Client joins their personal room or admin room
     * Expected data: { userId: string, role: string }
     */
    @SubscribeMessage('joinParams')
    handleJoinParams(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { userId: string; role: string },
    ) {
        if (data.userId) {
            const userRoom = `user-${data.userId}`;
            client.join(userRoom);
            this.logger.log(`Client ${client.id} joined ${userRoom}`);
        }

        if (data.role === 'admin') {
            client.join('admin');
            this.logger.log(`Client ${client.id} joined admin room`);
        }

        return { success: true };
    }

    /**
     * Emit event to a specific user
     */
    notifyUser(userId: string, event: string, payload: any) {
        this.server.to(`user-${userId}`).emit(event, payload);
    }

    /**
     * Emit event to all admins
     */
    notifyAdmins(event: string, payload: any) {
        this.server.to('admin').emit(event, payload);
    }
}
