const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const missing = await prisma.sessions.findMany({
    where: {
      status: 'completed',
      recording_url: null,
      video_provider: 'DAILYCO'
    }
  });
  console.log(`\n--- AUDIT RESULTS ---`);
  console.log(`Found ${missing.length} completed Daily.co sessions with missing recordings.`);
  if (missing.length > 0) {
    console.log(missing.map(m => m.id));
  }
}
run().finally(() => prisma.$disconnect());
