import { io } from 'socket.io-client';

async function testNotifications() {
    console.log('Connecting to Notification Gateway...');

    // 1. Simulate Admin Connection
    const adminSocket = io('http://localhost:3000/notifications', {
        transports: ['websocket'],
    });

    adminSocket.on('connect', () => {
        console.log('✅ Admin Socket Connected:', adminSocket.id);
        adminSocket.emit('joinParams', { role: 'admin', userId: 'admin-123' });
    });

    adminSocket.on('booking:created', (data) => {
        console.log('🎉 Admin received booking:created event:');
        console.dir(data, { depth: null });
        adminSocket.disconnect();
        process.exit(0);
    });

    // Keep alive
    setTimeout(() => {
        console.log('Timeout waiting for event. Ensure backend is running and you trigger a booking.');
        // process.exit(1);
    }, 30000);
}

testNotifications();
