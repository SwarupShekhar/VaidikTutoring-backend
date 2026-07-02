import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  try {
    await prisma.users.findFirst({
        where: { email: { equals: "test@test.com", mode: 'insensitive' } },
        orderBy: { created_at: 'asc' },
    });
    console.log("Success");
  } catch(e) {
    console.error(e);
  }
}
run();
