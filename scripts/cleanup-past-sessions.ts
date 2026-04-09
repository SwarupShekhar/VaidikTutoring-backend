
import { PrismaClient } from '@prisma/client';
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
    console.log('🧹 Starting cleanup of PAST bookings...');

    const now = new Date();
    console.log(`🕒 Deleting all bookings ending before: ${now.toISOString()}`);

    // Delete bookings where `requested_end` < now
    // Since Sessions have `onDelete: Cascade` related to Bookings, 
    // deleting bookings will automatically remove the sessions.
    const deletedBookings = await prisma.bookings.deleteMany({
        where: {
            requested_end: { lt: now }
        }
    });

    console.log(`🗑️  Deleted ${deletedBookings.count} past bookings.`);
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
