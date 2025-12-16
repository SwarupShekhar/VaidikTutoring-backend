import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Starting Granular Clean Up...');

    try {
        console.log('Deleting Session Messages...');
        await prisma.session_messages.deleteMany({});

        console.log('Deleting Session Recordings...');
        await prisma.session_recordings.deleteMany({});

        console.log('Deleting Sessions...');
        await prisma.sessions.deleteMany({});

        console.log('Deleting Bookings...');
        await prisma.bookings.deleteMany({});

        console.log('Deleting Assessment Attempts...');
        await prisma.assessment_attempts.deleteMany({});

        console.log('Deleting Progress Points...');
        await prisma.progress_points.deleteMany({});

        console.log('Deleting Tutor Shifts...');
        await prisma.tutor_shifts.deleteMany({});

        console.log('Deleting Students (Profiles)...');
        await prisma.students.deleteMany({});

        console.log('Deleting Tutors (Profiles)...');
        await prisma.tutors.deleteMany({});

        console.log('Deleting Notifications...');
        await prisma.notifications.deleteMany({});

        console.log('Deleting Audit Logs...');
        await prisma.audit_logs.deleteMany({});

        console.log('Deleting Non-Admin Users...');
        const deletedUsers = await prisma.users.deleteMany({
            where: {
                role: {
                    not: 'admin'
                }
            }
        });
        console.log(`Deleted ${deletedUsers.count} users.`);

        const adminCount = await prisma.users.count({ where: { role: 'admin' } });
        console.log(`Remaining Admin Users: ${adminCount}`);

    } catch (error) {
        console.error('Cleanup failed:', error);
        throw error;
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
