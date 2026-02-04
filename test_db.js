const { PrismaClient } = require('./generated/prisma');
const prisma = new PrismaClient();
async function main() {
  try {
    const student = await prisma.students.findFirst({ where: { email: 'test@example.com' } });
    console.log('DB SUCCESS: email field exists');
    process.exit(0);
  } catch (err) {
    console.error('DB ERROR:', err.message);
    process.exit(1);
  }
}
main();
