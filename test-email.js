const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const students = await prisma.students.findMany({ take: 5, include: { users_students_user_idTousers: true }});
  console.log(students.map(s => ({ id: s.id, email: s.email, user_id: s.user_id, userEmail: s.users_students_user_idTousers?.email })));
}
main().finally(() => prisma.$disconnect());
