const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '../.env' });

async function getToken() {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  
  const token = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    null,
    { headers: { Authorization: `Basic ${token}` } }
  );
  return response.data.access_token;
}

async function main() {
  const prisma = new PrismaClient();
  const sessions = await prisma.sessions.findMany({
    where: { zoom_meeting_id: { not: null } }
  });
  
  const token = await getToken();
  let count = 0;
  
  for (const s of sessions) {
    try {
      await axios.patch(
        `https://api.zoom.us/v2/meetings/${s.zoom_meeting_id}`,
        {
          settings: {
            approval_type: 2,
            meeting_authentication: false
          }
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      count++;
      console.log(`Updated ${s.zoom_meeting_id}`);
    } catch(e) {
      console.log(`Skipped ${s.zoom_meeting_id}: ${e.response?.status}`);
    }
  }
  console.log(`Updated ${count} meetings.`);
}

main().catch(console.error);
