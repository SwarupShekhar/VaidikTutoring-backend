
import { PrismaClient } from './generated/prisma/client.js';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.users.findMany({
    where: {
      OR: [
        { first_name: { contains: 'swarup', mode: 'insensitive' } },
        { last_name: { contains: 'swarup', mode: 'insensitive' } }
      ]
    }
  });

  console.log('Users found:', JSON.stringify(users, null, 2));

  for (const user of users) {
    const students = await prisma.students.findMany({
      where: { user_id: user.id }
    });
    console.log(`Students for user ${user.email}:`, JSON.stringify(students, null, 2));

    for (const student of students) {
      const bookings = await prisma.bookings.findMany({
        where: { student_id: student.id },
        include: { sessions: true }
      });
      console.log(`Bookings for student ${student.first_name}:`, JSON.stringify(bookings, null, 2));
    }
  }
}

main().finally(() => prisma.$disconnect());
