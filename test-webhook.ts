import crypto from 'crypto';
import axios from 'axios';

const SECRET = '31aVQtzCOFfp+SdQ+bvilW2OWWdGIVjcTcsmXYQk74I=';
const URL = 'https://api.studyhours.com/webhooks/daily';

const payload = {
  type: 'recording.ready-to-download',
  version: '1.0',
  payload: {
    room_name: 'k12-session-a01fefae-4ae8-477b-9e8a-dcf0a10e178d',
    recording_id: '90fd23df-aa8a-4e13-8707-0fe747794a83',
    start_ts: 1784636594,
    status: 'finished',
    max_participants: 2,
    duration: 300,
    share_token: 'dummy-token'
  }
};

const payloadString = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000).toString();
const signatureString = `${timestamp}.${payloadString}`;

const hmac = crypto.createHmac('sha256', SECRET);
const signature = hmac.update(signatureString).digest('hex');
const dailySignatureHeader = `t=${timestamp},v1=${signature}`;

async function run() {
  try {
    console.log(`Sending webhook to ${URL} ...`);
    const res = await axios.post(URL, payloadString, {
      headers: {
        'Content-Type': 'application/json',
        'Daily-Signature': dailySignatureHeader
      }
    });
    console.log('Success:', res.status, res.data);
  } catch (err: any) {
    console.error('Error:', err.response?.status, err.response?.data || err.message);
  }
}

run();
