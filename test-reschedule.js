const axios = require('axios');
async function test() {
  try {
    const res = await axios.patch('http://localhost:3001/admin/group-sessions/foo/reschedule', {
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString()
    }, {
      headers: { Authorization: "Bearer TEST_TOKEN" } // We will see if it hits AuthGuard
    });
    console.log(res.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}
test();
