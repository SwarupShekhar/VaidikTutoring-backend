import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sessionId = '63b89f02-7791-47c5-ba8a-ec445112d9f4';
  const session = await prisma.sessions.findUnique({
    where: { id: sessionId },
    include: {
      booking: {
        include: {
          student: {
            include: { user: true }
          },
          assignedTutor: {
            include: { user: true }
          }
        }
      }
    }
  });

  console.log(JSON.stringify(session, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
