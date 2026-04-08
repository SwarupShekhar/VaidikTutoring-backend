
import { PrismaClient } from './generated/prisma/client.js';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL missing');

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const summary = {
    users: await prisma.users.findMany({
      where: {
        OR: [
          { first_name: { contains: 'swarup', mode: 'insensitive' } },
          { last_name: { contains: 'swarup', mode: 'insensitive' } }
        ]
      },
      select: { id: true, email: true, first_name: true, last_name: true, role: true }
    }),
    students: await prisma.students.findMany({
      select: { id: true, first_name: true, last_name: true, total_hours_learned: true, streak_weeks: true, user_id: true }
    }),
    sessions: await prisma.sessions.findMany({
      select: { id: true, status: true, booking_id: true, tutor_note: true }
    }),
    bookings: await prisma.bookings.findMany({
      select: { id: true, student_id: true, status: true }
    })
  };

  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
  await pool.end();
}

main().catch(err => console.error(err));
