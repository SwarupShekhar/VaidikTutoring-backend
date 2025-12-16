import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Searching for new students...');
    const names = ['Thomas', 'Dough', 'Amit'];

    // Check Users
    const users = await prisma.users.findMany({
        where: {
            OR: [
                { first_name: { in: names, mode: 'insensitive' } },
                { last_name: { in: names, mode: 'insensitive' } }
            ]
        }
    });
    console.log('Users found:', users);

    // Check Students
    if (users.length > 0) {
        const userIds = users.map(u => u.id);
        const students = await prisma.students.findMany({
            where: {
                user_id: { in: userIds }
            }
        });
        console.log('Student profiles found:', students);
    } else {
        console.log('No users found with these names.');
    }

    // Check recent students
    const recentStudents = await prisma.students.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        include: { users_students_user_idTousers: true }
    });
    console.log('5 Most Recent Students:', recentStudents.map(s => ({
        id: s.id,
        name: s.first_name + ' ' + s.last_name,
        user_email: s.users_students_user_idTousers?.email
    })));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
