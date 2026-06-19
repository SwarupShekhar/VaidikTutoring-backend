import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Querying bookings with tutors...');
  const bookings = await prisma.bookings.findMany({
    where: { assigned_tutor_id: { not: null } },
    include: { tutors: { include: { users: true } } },
    take: 5,
    orderBy: { created_at: 'desc' }
  });

  for (const b of bookings) {
    console.log(`Booking ID: ${b.id}`);
    console.log(`Tutor ID: ${b.assigned_tutor_id}`);
    console.log(`Tutor User ID: ${b.tutors?.user_id}`);
    console.log(`Tutor Email: ${b.tutors?.users?.email}`);
    console.log('---');
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
