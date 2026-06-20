const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.session_recordings.count();
  console.log('Total recordings:', count);
}
main().catch(console.error).finally(() => prisma.$disconnect());
