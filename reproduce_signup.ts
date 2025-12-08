import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from './generated/prisma/client';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
    try {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error('DATABASE_URL environment variable is required');
        }

        const pool = new Pool({
            connectionString: databaseUrl,
            options: '-c search_path=app',
        });
        const adapter = new PrismaPg(pool);
        const prisma = new PrismaClient({ adapter });

        const sp = await prisma.$queryRaw`SHOW search_path`;
        console.log("Current search_path:", sp);

        const email = "parent1@example.com";
        const password = "test123";
        const role = "parent";

        console.log("Checking if user exists...");
        const exists = await prisma.users.findUnique({
            where: { email },
        });

        if (exists) {
            console.log("User already exists, deleting for test...");
            await prisma.users.delete({ where: { email } });
        }

        console.log("Hashing password...");
        const hash = await bcrypt.hash(password, 10);

        console.log("Creating user...");
        const user = await prisma.users.create({
            data: {
                email,
                password_hash: hash,
                first_name: "John",
                last_name: "Parent",
                role,
            },
        });
        console.log("User created successfully:", user);

        await prisma.$disconnect();
        await pool.end();

    } catch (e) {
        console.error("Error during reproduction:", e);
    }
}

main();
