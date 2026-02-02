
import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const targets = [
        { first: 'Thomas', last: 'Shelby' },
        { first: 'Jane', last: 'Doe' },
        { first: 'Socket', last: 'Tester' },
        { first: 'jack', last: 'k' },
    ];

    console.log('Starting FORCE cleanup (Targeting Students directly)...');

    for (const target of targets) {
        console.log(`Looking for Students: ${target.first} ${target.last}...`);

        // Find students by name (insensitive)
        const students = await prisma.students.findMany({
            where: {
                first_name: { equals: target.first, mode: 'insensitive' },
                last_name: { equals: target.last, mode: 'insensitive' },
            }
        });

        console.log(`Found ${students.length} student records for ${target.first} ${target.last}.`);

        for (const student of students) {
            console.log(`  Cleaning up student ${student.id} (${student.first_name} ${student.last_name})...`);

            // 1. Delete Bookings
            const deletedBookings = await prisma.bookings.deleteMany({
                where: { student_id: student.id }
            });
            console.log(`    Deleted ${deletedBookings.count} bookings.`);

            // 2. Delete Student
            await prisma.students.delete({ where: { id: student.id } });
            console.log(`    Deleted student record.`);
        }
    }
    console.log('Cleanup complete.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
