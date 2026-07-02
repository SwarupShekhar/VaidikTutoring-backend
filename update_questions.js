const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const questions = await prisma.assessment_questions.findMany({
    where: { curriculum_id: 'psle', grade: 'p5' }
  });

  console.log(`Found ${questions.length} questions to update.`);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await prisma.assessment_questions.update({
      where: { id: q.id },
      data: {
        content: {
          question_text: `Sample PSLE Math Question #${i + 1}: What is ${i + 2} + ${i + 3}?`,
          options: [
            `${(i + 2) + (i + 3)}`,
            `${(i + 2) + (i + 3) + 1}`,
            `${(i + 2) + (i + 3) - 1}`,
            `${(i + 2) + (i + 3) + 2}`
          ]
        },
        correct_answer: `${(i + 2) + (i + 3)}`
      }
    });
  }
  
  console.log('Successfully updated all questions!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
