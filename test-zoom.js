const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

async function main() {
  const prisma = new PrismaClient();
  const session = await prisma.sessions.findFirst({
    where: { zoom_meeting_id: { not: null } },
    orderBy: { created_at: 'desc' }
  });
  
  if (!session) {
    console.log("No session.");
    return;
  }
  console.log("Zoom meeting ID:", session.zoom_meeting_id);
}
main().catch(console.error);
