const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDuplicates() {
  const duplicates = await prisma.users.groupBy({
    by: ['phone'],
    _count: {
      phone: true,
    },
    having: {
      phone: {
        _count: {
          gt: 1,
        },
      },
    },
  });

  const validDuplicates = duplicates.filter(d => d.phone !== null && d.phone !== '');

  if (validDuplicates.length === 0) {
    console.log('No duplicate phone numbers found.');
  } else {
    console.log('Found duplicate phone numbers:');
    for (const d of validDuplicates) {
      const users = await prisma.users.findMany({
        where: { phone: d.phone },
        select: { id: true, email: true, phone_verified: true },
      });
      console.log(`Phone: ${d.phone} (Count: ${d._count.phone})`);
      users.forEach(u => console.log(`  - User: ${u.id}, Email: ${u.email}, Verified: ${u.phone_verified}`));
    }
  }
}

checkDuplicates()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
