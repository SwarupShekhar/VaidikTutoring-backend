import { io } from 'socket.io-client';

const API_URL = 'http://localhost:3000';
const USER_EMAIL = 'parent@example.com';
const USER_PASS = 'password123'; // Make sure this user exists in your seed

// Helper for REST requests
async function request(url: string, options: any = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const resp = await fetch(url, { ...options, headers });
    const text = await resp.text();
    return { status: resp.status, data: text ? JSON.parse(text) : null };
}

async function runTest() {
    console.log('🚀 Starting E2E Notification Test...');

    // 1. Setup Admin Socket Listener
    const adminSocket = io(`${API_URL}/notifications`, { transports: ['websocket'] });

    const socketPromise = new Promise((resolve, reject) => {
        adminSocket.on('connect', () => {
            console.log('✅ Admin Socket Connected');
            adminSocket.emit('joinParams', { role: 'admin' });
        });

        adminSocket.on('booking:created', (data) => {
            console.log('🎉 Admin Notification Received:', data);
            resolve(data);
        });

        // Timeout
        setTimeout(() => reject('Timeout waiting for notification'), 15000);
    });

    // 2. Perform Booking via REST
    try {
        // Login
        console.log('🔐 Logging in...');
        let loginRes = await request(`${API_URL}/auth/login`, {
            method: 'POST',
            body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS })
        });

        if (loginRes.status !== 201) {
            // Try signup if login fails
            console.log('⚠️ Login failed, trying signup...');
            await request(`${API_URL}/auth/signup`, {
                method: 'POST',
                body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS, role: 'parent', first_name: 'TestParent' })
            });
            loginRes = await request(`${API_URL}/auth/login`, {
                method: 'POST',
                body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS })
            });
        }

        const token = loginRes.data.token;
        if (!token) throw new Error('No token received');
        console.log('✅ Logged in');

        // Get Catalog IDs
        const [sub, cur, pkg] = await Promise.all([
            request(`${API_URL}/subjects`),
            request(`${API_URL}/curricula`),
            request(`${API_URL}/packages`)
        ]);

        const subjectId = sub.data[0].id;
        const curriculumId = cur.data[0].id;
        const packageId = pkg.data[0].id;

        // Create Student
        console.log('🎓 Creating Student...');
        const studentRes = await request(`${API_URL}/students`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                first_name: 'TestStudent_' + Date.now(),
                last_name: 'E2E',
                grade: '10',
                school: 'Test School'
            })
        });

        if (studentRes.status !== 201) {
            throw new Error(`Failed to create student: ${JSON.stringify(studentRes.data)}`);
        }
        const studentId = studentRes.data.id;
        console.log('✅ Student Created:', studentId);

        // Create Booking
        console.log('📅 Creating Booking...');
        const bookingRes = await request(`${API_URL}/bookings/create`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                student_id: studentId,
                package_id: packageId,
                subject_ids: [subjectId],
                curriculum_id: curriculumId,
                requested_start: new Date(Date.now() + 1000000).toISOString(),
                requested_end: new Date(Date.now() + 2000000).toISOString(),
                note: 'E2E Notification Test'
            })
        });

        if (bookingRes.status !== 201) {
            console.error('Booking failed:', bookingRes.data);
        } else {
            console.log('✅ Booking Created');
        }

    } catch (e) {
        console.error('REST Error:', e);
    }

    // 3. Wait for Socket Result
    try {
        await socketPromise;
        console.log('✅ TEST PASSED: Notification received successfully.');
        process.exit(0);
    } catch (e) {
        console.error('❌ TEST FAILED:', e);
        process.exit(1);
    }
}

runTest();
