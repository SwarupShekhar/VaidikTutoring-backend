import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all learning students where sessions_remaining doesn't match subscription_credits
  const students = await prisma.students.findMany({
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      subscription_credits: true,
      sessions_remaining: true,
      enrollment_status: true,
      subscription_plan: true,
    },
  });

  const mismatched = students.filter(
    (s) => s.sessions_remaining !== s.subscription_credits,
  );

  console.log(`\nTotal students: ${students.length}`);
  console.log(`Students with mismatched sessions_remaining: ${mismatched.length}\n`);

  for (const s of mismatched) {
    console.log(
      `[${s.enrollment_status}] ${s.first_name} ${s.last_name || ''} (${s.email || s.id}): ` +
        `subscription_credits=${s.subscription_credits}, sessions_remaining=${s.sessions_remaining} → FIXING`,
    );

    await prisma.students.update({
      where: { id: s.id },
      data: {
        sessions_remaining: s.subscription_credits,
      },
    });
  }

  console.log('\n✅ Done — sessions_remaining is now in sync with subscription_credits for all students.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
