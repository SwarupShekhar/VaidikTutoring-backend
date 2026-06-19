import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
  const sessionId = 'b6420f2a-5df3-44b8-a4a3-cc971680de9a';
  
  // 1. Try as Session ID
  let booking = null;
  const session = await prisma.sessions.findUnique({
    where: { id: sessionId },
    include: { bookings: { include: { students: true, tutors: true } } },
  });

  if (session) {
    booking = session.bookings;
    console.log('Found by Session ID');
  } else {
    // 2. Try as Booking ID
    booking = await prisma.bookings.findUnique({
      where: { id: sessionId },
      include: { students: true, tutors: true },
    });
    console.log('Found by Booking ID');
  }
  
  console.log(JSON.stringify(booking, null, 2));
}
test().catch(console.error).finally(() => prisma.$disconnect());
