
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const students = await prisma.students.findMany({
      where: { first_name: 'swarup.shekhar' },
      select: {
        id: true,
        first_name: true,
        enrollment_status: true,
        subscription_plan: true,
        subscription_credits: true,
        subscription_starts: true,
        subscription_ends: true,
        is_trial_active: true,
      }
    });
    console.log(JSON.stringify(students, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
