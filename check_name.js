const { PrismaClient } = require('@prisma/client');

async function main() {
  process.env.DATABASE_URL = "postgresql://studyhours_user:studyhourstardigrade9876@localhost:4015/studyhours_db?pgbouncer=true";
  const prisma = new PrismaClient();
  
  const bookings = await prisma.bookings.findMany({
    orderBy: { created_at: 'desc' },
    include: { student: { include: { user: true } } },
    take: 100
  });

  for (const b of bookings) {
    const studentFirstName = b.student?.user?.first_name || b.student?.first_name || '';
    const studentLastName = b.student?.user?.last_name || b.student?.last_name || '';
    const studentEmail = b.student?.user?.email || b.student?.email || '';
    
    if (studentEmail.toLowerCase().includes('mandsha') || studentFirstName.toLowerCase().includes('mandsha')) {
       console.log(`Name: ${studentFirstName} ${studentLastName}`);
       console.log(`Email: ${studentEmail}`);
    }
  }
}

main().catch(e => console.error(e)).finally(() => process.exit(0));
