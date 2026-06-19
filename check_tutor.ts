import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.users.findMany({
    where: { role: 'tutor' },
    include: { tutors: true }
  });
  console.log('Tutors in DB:', JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
