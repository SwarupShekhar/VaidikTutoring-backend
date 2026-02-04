import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  try {
    const student = await prisma.students.findFirst({ where: { email: 'test@example.com' } })
    console.log('DB SUCCESS: email field exists')
  } catch (err) {
    console.error('DB ERROR:', err.message)
  }
}
main()
