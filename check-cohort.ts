import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRawUnsafe(`
    SELECT role, onboarding_status, count(*)
    FROM app.users
    WHERE role IN ('student','parent')
    GROUP BY role, onboarding_status
    ORDER BY count(*) DESC;
  `);
  // Convert BigInts to strings for JSON.stringify to work without throwing
  console.log(JSON.stringify(result, (key, value) =>
      typeof value === 'bigint'
          ? value.toString()
          : value 
  , 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
