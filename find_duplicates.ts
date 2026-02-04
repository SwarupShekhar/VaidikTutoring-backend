import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const duplicates = await prisma.`
    SELECT email, COUNT(*) 
    FROM students 
    WHERE email IS NOT NULL 
    GROUP BY email 
    HAVING COUNT(*) > 1
  `
  console.log('Duplicate emails in students:', duplicates)

  const studentUsers = await prisma.users.findMany({ where: { role: 'student' } })
  for (const u of studentUsers) {
    const profiles = await prisma.students.findMany({ where: { user_id: u.id } })
    if (profiles.length > 1) {
      console.log(`User ${u.email} (${u.id}) has ${profiles.length} profiles!`)
    }
  }
}

main()
