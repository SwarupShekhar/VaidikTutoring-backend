const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.curricula.upsert({
    where: { id: 'psle' },
    update: {},
    create: {
      id: 'psle',
      name: 'PSLE (Singapore)',
      region: 'Singapore',
      description: 'Primary School Leaving Examination',
      status: 'active'
    }
  });
  console.log('Inserted psle curriculum');
  
  // also check grades for psle
}

main().catch(console.error).finally(() => prisma.$disconnect());
