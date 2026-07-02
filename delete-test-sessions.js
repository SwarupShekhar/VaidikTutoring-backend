const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const bookings = await prisma.bookings.findMany({
    where: { booking_type: 'GROUP' },
    include: { sessions: true }
  });
  console.log(`Found ${bookings.length} group bookings.`);
  let zoomCount = 0;
  bookings.forEach(b => {
    b.sessions.forEach(s => {
      if (s.zoom_meeting_id) zoomCount++;
    });
  });
  console.log(`Found ${zoomCount} Zoom meetings tied to them.`);
}
check().catch(console.error).finally(() => prisma.$disconnect());
