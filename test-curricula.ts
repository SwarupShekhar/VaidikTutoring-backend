import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const cur = await prisma.curricula.findMany({ select: { id: true } });
  console.log("Curricula:", cur.map(c => c.id));
  const aq = await prisma.assessment_questions.findMany({ select: { curriculum_id: true, grade: true }, distinct: ['curriculum_id', 'grade'] });
  console.log("Assessment Tags:", aq);
}
main().catch(console.error).finally(() => prisma.$disconnect());
