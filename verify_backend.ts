const API_URL = 'http://localhost:3000';
// You might need to adjust credentials based on your seeded data
const USER_EMAIL = 'parent@example.com';
const USER_PASS = 'password123';

async function request(url, options = {}) {
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });

        let data;
        const text = await response.text();
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = text;
        }

        if (!response.ok) {
            const error = new Error(typeof data === 'object' && data.message ? data.message : 'Request failed');
            error.response = { status: response.status, data };
            throw error;
        }
        return { data, status: response.status };
    } catch (error) {
        throw error;
    }
}

async function runVerification() {
    console.log('🚀 Starting Verification...');

    let token = '';
    let studentId = '';

    // 1. Login or Signup
    console.log('\n🔐 Logging in...');
    try {
        const res = await request(`${API_URL}/auth/login`, {
            method: 'POST',
            body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS })
        });
        console.log('Debug: Login Response:', res.data);
        token = res.data.token;
        console.log('✅ Login successful');
    } catch (error: any) {
        if (error.response?.status === 401) {
            console.log('⚠️ Login failed, attempting signup...');
            try {
                await request(`${API_URL}/auth/signup`, {
                    method: 'POST',
                    body: JSON.stringify({
                        email: USER_EMAIL,
                        password: USER_PASS,
                        role: 'parent',
                        first_name: 'Test',
                        last_name: 'Parent'
                    })
                });
                console.log('✅ Signup successful, logging in...');
                const res = await request(`${API_URL}/auth/login`, {
                    method: 'POST',
                    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS })
                });
                token = res.data.token;
                console.log('✅ Login successful after signup');
            } catch (signupError: any) {
                console.error('❌ Signup failed:', signupError.response?.data || signupError.message);
                return;
            }
        } else {
            console.error('❌ Login failed:', error.response?.data || error.message);
            return;
        }
    }

    console.log('Debug: Token:', token.substring(0, 20) + '...');
    const authHeaders = { Authorization: `Bearer ${token}` };
    console.log('Debug: Headers:', authHeaders);

    // 2. Students Module
    console.log('\n--- 🎓 Students Module ---');
    try {
        console.log('Creating student...');
        const res = await request(`${API_URL}/students`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                first_name: 'TestStudent',
                last_name: 'Verif',
                grade: '10',
                school: 'Test High'
            })
        });

        console.log('Response:', res.data);
        if (res.data.id && res.data.first_name === 'TestStudent') {
            studentId = res.data.id;
            console.log('✅ Student created successfully with full object');
        } else {
            console.error('❌ Student response missing data');
        }
    } catch (error) {
        console.error('❌ Create Student failed:', error.response?.data || error.message);
    }

    // 3. Bookings Module
    console.log('\n--- 📅 Bookings Module ---');
    try {
        // Fetch valid IDs
        const [subRes, curRes, pkgRes] = await Promise.all([
            request(`${API_URL}/subjects`),
            request(`${API_URL}/curricula`),
            request(`${API_URL}/packages`)
        ]);

        const subjectId = subRes.data[0]?.id;
        const curriculumId = curRes.data[0]?.id;
        const packageId = pkgRes.data[0]?.id;

        if (!subjectId || !curriculumId || !packageId) {
            console.error('❌ Could not fetch catalog data. Skipping booking tests.');
        } else {
            console.log(`Using IDs: Sub=${subjectId}, Cur=${curriculumId}, Pkg=${packageId}`);

            console.log('Testing Validation (Past Date)...');
            await request(`${API_URL}/bookings/create`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    student_id: studentId,
                    package_id: packageId,
                    subject_ids: [subjectId],
                    curriculum_id: curriculumId,
                    requested_start: new Date(Date.now() - 100000).toISOString(),
                    requested_end: new Date(Date.now() + 100000).toISOString()
                })
            }).catch((err: any) => {
                if (err.response?.status === 403 || err.response?.status === 400) {
                    console.log('✅ Past date validation caught:', err.response.data);
                } else {
                    console.error('❌ Unexpected error for past date:', err.response?.status, err.response?.data);
                }
            });

            console.log('Testing Validation (End < Start)...');
            await request(`${API_URL}/bookings/create`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    student_id: studentId,
                    package_id: packageId,
                    subject_ids: [subjectId],
                    curriculum_id: curriculumId,
                    requested_start: new Date(Date.now() + 100000).toISOString(),
                    requested_end: new Date(Date.now()).toISOString()
                })
            }).catch((err: any) => {
                if (err.response?.status === 403 || err.response?.status === 400) {
                    console.log('✅ End < Start validation caught:', err.response.data);
                } else {
                    console.error('❌ Unexpected error for end < start:', err.response?.status, err.response?.data);
                }
            });

            console.log('Testing SUCCESSFUL Booking...');
            const successRes = await request(`${API_URL}/bookings/create`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    student_id: studentId,
                    package_id: packageId,
                    subject_ids: [subjectId],
                    curriculum_id: curriculumId,
                    requested_start: new Date(Date.now() + 1000000).toISOString(),
                    requested_end: new Date(Date.now() + 2000000).toISOString()
                })
            });

            console.log('Booking Response Array Length:', successRes.data.length);
            const firstBooking = successRes.data[0];
            if (firstBooking && firstBooking.subjects && firstBooking.students && firstBooking.packages) {
                console.log('✅ Valid Booking Created with ENRICHED relations:', Object.keys(firstBooking));
            } else {
                console.error('❌ Booking created but missing enriched data:', firstBooking);
            }
        }

    } catch (error) {
        console.error('❌ Verification Check failed', error);
    }

    // 4. Sessions
    console.log('\n--- ⏱️ Sessions Module ---');
    try {
        console.log('Fetching Sessions...');
        const res = await request(`${API_URL}/sessions`, {
            method: 'GET',
            headers: authHeaders
        });
        if (Array.isArray(res.data)) {
            console.log(`✅ Fetched ${res.data.length} sessions (Sorted ASC check visually if needed)`);
            // Check structure
            if (res.data.length > 0 && res.data[0].bookings) {
                console.log('✅ Session has relation data:', Object.keys(res.data[0].bookings));
            }
        } else {
            console.error('❌ Sessions response is not an array');
        }
    } catch (error) {
        console.error('❌ Get Sessions failed:', error.response?.data || error.message);
    }

    // 5. Cleanup (Delete Student)
    console.log('\n--- 🧹 Cleanup ---');
    if (studentId) {
        try {
            console.log('Deleting student...');
            const res = await request(`${API_URL}/students/${studentId}`, {
                method: 'DELETE',
                headers: authHeaders
            });
            console.log('✅ Delete successful. Result:', res.data ? 'Parent Object Returned' : 'Empty');
        } catch (error) {
            console.error('❌ Delete failed:', error.response?.data || error.message);
        }
    }
}

runVerification();
