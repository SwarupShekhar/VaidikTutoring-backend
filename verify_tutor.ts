import axios from 'axios';

async function main() {
    const baseUrl = 'http://localhost:3000';

    // 1. Login as Admin
    console.log('Logging in as Admin...');
    let token;
    try {
        const loginRes = await axios.post(`${baseUrl}/auth/login`, {
            email: 'swarupshekhar.vaidikedu@gmail.com',
            password: 'Vaidik@1234'
        });
        token = loginRes.data.access_token;
        console.log('Admin Logged In. Token acquired.');
    } catch (e) {
        console.error('Login Failed:', e.response?.data || e.message);
        process.exit(1);
    }

    // 2. Create Tutor
    console.log('Creating Tutor...');
    try {
        const tutorData = {
            email: `tutor.test.${Date.now()}@example.com`,
            first_name: 'Test',
            last_name: 'Tutor',
            subjects: ['math', 'physics'],
            // password is optional, testing without it to verify invite flow
        };

        const res = await axios.post(`${baseUrl}/admin/tutors`, tutorData, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Tutor Created Successfully!');
        console.log('Response:', res.data);
    } catch (e) {
        console.error('Create Tutor Failed:', e.response?.data || e.message);
        if (e.response?.status === 404) console.error('Endpoint not found!');
        if (e.response?.status === 403) console.error('Forbidden - check guards!');
        process.exit(1);
    }
}

main();
