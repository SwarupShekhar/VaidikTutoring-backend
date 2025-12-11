// src/verify_backend.ts
// Lightweight verification script for the backend API used during CI / local checks.
// Usage: `ts-node src/verify_backend.ts` or run as part of build/test scripts.
//
// Notes:
// - options param is typed so `options.headers` is allowed.
// - Non-2xx responses throw an Error-like object with `.response = { status, data }`.

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
// You might need to adjust credentials based on your seeded data
const USER_EMAIL = process.env.VERIFY_USER_EMAIL ?? 'parent@example.com';
const USER_PASS = process.env.VERIFY_USER_PASS ?? 'password123';

type RequestOptions = Omit<RequestInit, 'headers'> & {
    headers?: Record<string, string>;
    // allow extra keys as required
    [key: string]: any;
};

async function request(url: string, options: RequestOptions = {}): Promise<{ data: any; status: number }> {
    // merge headers while keeping types happy
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };

    try {
        const resp = await fetch(url, { ...options, headers });
        const text = await resp.text();

        let data: any = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            // not JSON, return raw text
            data = text;
        }

        if (!resp.ok) {
            // create an Error-like object and attach .response for callers to read
            const err: any = new Error(typeof data === 'object' && data?.message ? data.message : `Request failed with status ${resp.status}`);
            err.response = { status: resp.status, data };
            throw err;
        }

        return { data, status: resp.status };
    } catch (err) {
        // re-throw errors that already have `.response`
        if ((err as any)?.response) throw err;
        // wrap network errors for consistent shape
        const wrap: any = new Error('Network or parse error when contacting backend');
        wrap.original = err;
        throw wrap;
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
            body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS }),
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
                        last_name: 'Parent',
                    }),
                });
                console.log('✅ Signup successful, logging in...');
                const res = await request(`${API_URL}/auth/login`, {
                    method: 'POST',
                    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASS }),
                });
                token = res.data.token;
                console.log('✅ Login successful after signup');
            } catch (signupError: any) {
                console.error('❌ Signup failed:', signupError.response?.data || signupError.message || signupError);
                return;
            }
        } else {
            console.error('❌ Login failed:', error.response?.data || error.message || error);
            return;
        }
    }

    console.log('Debug: Token:', token ? token.substring(0, 20) + '...' : '(none)');
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    console.log('Debug: Headers sample:', authHeaders);

    // 2. Students Module
    console.log('\n--- 🎓 Students Module ---');
    try {
        console.log('Creating student...');
        const uniqueName = 'TestStudent_' + Date.now();
        const res = await request(`${API_URL}/students`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                first_name: uniqueName,
                last_name: 'Verif',
                grade: '10',
                school: 'Test High',
            }),
        });

        console.log('Response:', res.data);
        if (res.data?.id && res.data?.first_name === uniqueName) {
            studentId = res.data.id;
            console.log('✅ Student created successfully with full object');
        } else {
            console.error('❌ Student response missing expected data:', res.data);
        }
    } catch (error: any) {
        console.error('❌ Create Student failed:', error.response?.data || error.message || error);
    }

    // 3. Bookings Module
    console.log('\n--- 📅 Bookings Module ---');
    try {
        // Fetch valid IDs
        const [subRes, curRes, pkgRes] = await Promise.all([
            request(`${API_URL}/subjects`),
            request(`${API_URL}/curricula`),
            request(`${API_URL}/packages`),
        ]);

        const subjectId = subRes.data?.[0]?.id;
        const curriculumId = curRes.data?.[0]?.id;
        const packageId = pkgRes.data?.[0]?.id;

        if (!subjectId || !curriculumId || !packageId) {
            console.error('❌ Could not fetch catalog data. Skipping booking tests. Subjects/Curricula/Packages missing.');
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
                    requested_end: new Date(Date.now() + 100000).toISOString(),
                }),
            }).catch((err: any) => {
                if (err.response?.status === 403 || err.response?.status === 400) {
                    console.log('✅ Past date validation caught:', err.response.data);
                } else {
                    console.error('❌ Unexpected error for past date:', err.response?.status, err.response?.data || err.message);
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
                    requested_end: new Date(Date.now()).toISOString(),
                }),
            }).catch((err: any) => {
                if (err.response?.status === 403 || err.response?.status === 400) {
                    console.log('✅ End < Start validation caught:', err.response.data);
                } else {
                    console.error('❌ Unexpected response for end < start:', err.response?.status, err.response?.data || err.message);
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
                    requested_end: new Date(Date.now() + 2000000).toISOString(),
                }),
            });

            // some backends may return created booking object or array; handle both
            const bookingsPayload = successRes.data;
            if (Array.isArray(bookingsPayload)) {
                console.log('Booking Response Array Length:', bookingsPayload.length);
                const firstBooking = bookingsPayload[0];
                if (firstBooking && firstBooking.subjects && firstBooking.students && firstBooking.packages) {
                    console.log('✅ Valid Booking Created with ENRICHED relations:', Object.keys(firstBooking));
                } else {
                    console.error('❌ Booking created but missing enriched data (array variant):', firstBooking);
                }
            } else if (bookingsPayload && bookingsPayload.id) {
                console.log('✅ Single booking object created:', Object.keys(bookingsPayload));
            } else {
                console.warn('⚠️ Booking response shape unexpected:', bookingsPayload);
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
            headers: authHeaders,
        });
        if (Array.isArray(res.data)) {
            console.log(`✅ Fetched ${res.data.length} sessions`);
            if (res.data.length > 0 && res.data[0].bookings) {
                console.log('✅ Session has relation data:', Object.keys(res.data[0].bookings));
            }
        } else {
            console.error('❌ Sessions response is not an array:', res.data);
        }
    } catch (error: any) {
        console.error('❌ Get Sessions failed:', error.response?.data || error.message || error);
    }

    // 5. Admin Tutor Creation (New)
    console.log('\n--- 👮 Admin Tutor Creation ---');
    try {
        console.log('Testing create tutor as PARENT (Expect Forbidden)...');
        await request(`${API_URL}/auth/admin/tutors`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                email: 'newtutor@example.com',
                first_name: 'Tutor',
                last_name: 'One',
            }),
        }).catch((err: any) => {
            if (err.response?.status === 403) {
                console.log('✅ Forbidden caught (As expected for non-admin)');
            } else {
                console.error('❌ Unexpected response for non-admin:', err.response?.status, err.response?.data || err.message);
            }
        });
    } catch (error) {
        console.error('❌ admin test failed', error);
    }

    // 6. Cleanup (Delete Student)
    console.log('\n--- 🧹 Cleanup ---');
    if (studentId) {
        try {
            console.log('Deleting student...');
            const res = await request(`${API_URL}/students/${studentId}`, {
                method: 'DELETE',
                headers: authHeaders,
            });
            console.log('✅ Delete successful. Result:', res.data ? 'Returned data' : 'Empty');
        } catch (error: any) {
            console.error('❌ Delete failed:', error.response?.data || error.message || error);
        }
    }

    console.log('\n🏁 Verification complete.');
}

runVerification().catch((e) => {
    console.error('Unhandled error in verification run:', e);
    process.exit(1);
});