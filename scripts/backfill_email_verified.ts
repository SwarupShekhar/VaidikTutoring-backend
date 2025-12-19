import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { PrismaClient } from '../generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as process from 'node:process';

async function main() {
    console.log('Starting backfill for email_verified...');

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is required');
    }

    const pool = new Pool({
        connectionString: databaseUrl,
    });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
        await prisma.$connect();
        const result = await prisma.users.updateMany({
            where: {
                email_verified: false,
            },
            data: {
                email_verified: true,
            },
        });
        console.log(`Updated ${result.count} users to verified.`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
