import { PrismaClient } from '../generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

// Manual .env loader
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🔍 Checking for stuck advisory locks (Prisma lock ID: 72707369)...');

    // Prisma Migrate uses the advisory lock key 72707369
    // We check for any session holding this lock.
    const locks = await prisma.$queryRawUnsafe<any[]>(`
    SELECT l.pid, mode, granted, client_addr, state, query_start
    FROM pg_locks l
    JOIN pg_stat_activity a ON l.pid = a.pid
    WHERE l.locktype = 'advisory'
    AND (
      (l.classid::bigint << 32) | l.objid::bigint = 72707369
      OR l.objid = 72707369
    )
  `);

    if (Array.isArray(locks) && locks.length > 0) {
        console.log(`⚠️  Found ${locks.length} active session(s) holding the lock:`);
        console.table(locks);

        for (const lock of locks) {
            const pid = lock.pid;
            if (pid) {
                console.log(`🧨 Attempting to terminate session PID: ${pid}...`);
                try {
                    await prisma.$executeRawUnsafe(`SELECT pg_terminate_backend(${pid});`);
                    console.log(`✅ Terminated session ${pid}`);
                } catch (e) {
                    console.error(`❌ Failed to terminate session ${pid}:`, e);
                }
            }
        }
    } else {
        console.log('✅ No stuck locks found. The lock might have been released or is not currently held.');
    }
}

main()
    .catch((e) => {
        console.error('❌ Error executing script:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
