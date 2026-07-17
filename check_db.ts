import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Querying for mandshagunk...');
  const bookings = await prisma.bookings.findMany({
    orderBy: { created_at: 'desc' },
    include: { student: { include: { user: true } } },
    take: 100
  });

  for (const b of bookings) {
    const studentFirstName = b.student?.user?.first_name || b.student?.first_name || '';
    const studentLastName = b.student?.user?.last_name || b.student?.last_name || '';
    const studentEmail = b.student?.user?.email || b.student?.email || '';
    
    if (studentFirstName.toLowerCase().includes('mandsha') || studentLastName.toLowerCase().includes('mandsha') || studentEmail.toLowerCase().includes('mandsha')) {
       console.log(`Booking ID: ${b.id}`);
       console.log(`Name: ${studentFirstName} ${studentLastName}`);
       console.log(`Email: ${studentEmail}`);
       console.log('---');
    }
  }

  // Find users with role tutor that don't have a tutor record
  const tutorsWithoutRecord = await prisma.users.findMany({
    where: {
      role: 'tutor',
      tutors: { none: {} }
    }
  });

  console.log(`Users with role 'tutor' but no tutor record: ${tutorsWithoutRecord.length}`);
  tutorsWithoutRecord.forEach(u => console.log(` - ${u.email} (${u.id})`));

  // Find duplicate emails (case insensitive)
  const allUsers = await prisma.users.findMany({
    select: { email: true, id: true }
  });
  
  const emailMap = new Map();
  allUsers.forEach(u => {
    const lower = (u.email || '').toLowerCase();
    if (!emailMap.has(lower)) emailMap.set(lower, []);
    emailMap.get(lower).push(u.email);
  });

  const duplicates = Array.from(emailMap.entries()).filter(([_, emails]) => emails.length > 1);
  console.log(`Duplicate emails (case-insensitive): ${duplicates.length}`);
  duplicates.forEach(([lower, emails]) => console.log(` - ${lower}: ${emails.join(', ')}`));

}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
