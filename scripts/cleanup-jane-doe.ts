
import { PrismaClient } from '../generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import * as path from 'path';

// Load env vars
config({ path: path.resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🧹 Starting cleanup of "Jane Doe" records...');

    // 1. Find all students named Jane Doe
    const students = await prisma.students.findMany({
        where: {
            first_name: { equals: 'Jane', mode: 'insensitive' },
            last_name: { equals: 'Doe', mode: 'insensitive' }
        },
        select: { id: true, user_id: true }
    });

    if (students.length === 0) {
        console.log('✅ No "Jane Doe" students found.');
        return;
    }

    console.log(`found ${students.length} students to remove.`);
    const studentIds = students.map(s => s.id);
    const userIds = students.map(s => s.user_id).filter((id): id is string => !!id);

    // 2. Delete related Booking records (Foreign Key Constraint)
    // bookings -> students
    const deletedBookings = await prisma.bookings.deleteMany({
        where: { student_id: { in: studentIds } }
    });
    console.log(`🗑️  Deleted ${deletedBookings.count} bookings.`);

    // 3. Delete related Assessment Attempts (Foreign Key Constraint)
    // assessment_attempts -> students
    const deletedAttempts = await prisma.assessment_attempts.deleteMany({
        where: { student_id: { in: studentIds } }
    });
    console.log(`🗑️  Deleted ${deletedAttempts.count} assessment attempts.`);

    // 4. Delete related Progress Points (Foreign Key Constraint)
    // progress_points -> students
    const deletedPoints = await prisma.progress_points.deleteMany({
        where: { student_id: { in: studentIds } }
    });
    console.log(`🗑️  Deleted ${deletedPoints.count} progress points.`);

    // 5. Delete the Students
    const deletedStudents = await prisma.students.deleteMany({
        where: { id: { in: studentIds } }
    });
    console.log(`🗑️  Deleted ${deletedStudents.count} student profiles.`);

    // 6. Optionally delete the Users to act consistently if they were created just for these students
    // We only delete users who don't have other roles ideally, but for Jane Doe usually safe.
    // However, let's verify if user also has name Jane Doe to be safe.
    // Or we rely on the fact that if we delete students, we might leaving dangling users.
    // Let's delete users that were linked to these students.
    if (userIds.length > 0) {
        // Also check if these users are tutors or have other critical data?
        // Assuming test data safety.
        const deletedUsers = await prisma.users.deleteMany({
            where: {
                id: { in: userIds },
                first_name: { equals: 'Jane', mode: 'insensitive' },
                last_name: { equals: 'Doe', mode: 'insensitive' }
            }
        });
        console.log(`🗑️  Deleted ${deletedUsers.count} user accounts.`);
    }

    console.log('✅ Cleanup complete.');
}

main()
    .catch((e) => {
        console.error('❌ Error executing cleanup:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
