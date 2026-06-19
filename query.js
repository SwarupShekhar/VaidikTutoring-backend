require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=require') || databaseUrl.includes('neon.tech')
      ? { rejectUnauthorized: false }
      : undefined,
  });
  
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log('Fetching users...');
  const users = await prisma.users.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    select: {
      id: true,
      email: true,
      role: true,
      phone_verified: true
    }
  });
  console.table(users);
  
  console.log('Fetching tutors...');
  const tutors = await prisma.tutors.findMany({
    orderBy: { created_at: 'desc' },
    take: 5,
    select: {
      id: true,
      user_id: true,
      users: { select: { email: true, role: true, phone_verified: true } }
    }
  });
  console.log(JSON.stringify(tutors, null, 2));

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
