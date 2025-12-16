import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is not defined');
        process.exit(1);
    }

    const pool = new Pool({ connectionString });

    try {
        console.log('Connecting to database...');

        // 1. Drop the 'app' schema where your tables live
        console.log('Dropping schema "app" and all its tables (CASCADE)...');
        await pool.query('DROP SCHEMA IF EXISTS "app" CASCADE');
        console.log('✅ Schema "app" dropped successfully.');

        // 2. Drop PUBLIC schema to ensure no hidden tables/extensions blocking reset
        console.log('Dropping schema "public" (CASCADE)...');
        await pool.query('DROP SCHEMA IF EXISTS "public" CASCADE');
        await pool.query('CREATE SCHEMA "public"');
        await pool.query('GRANT ALL ON SCHEMA "public" TO public'); // Restore default perms
        console.log('✅ Schema "public" recreated successfully.');

    } catch (e) {
        console.error('❌ Error during force reset:', e);
    } finally {
        await pool.end();
        console.log('Done. You can now run "npx prisma migrate dev".');
    }
}

main();
