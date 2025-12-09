import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString, options: '-c search_path=app' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Seeding data...');

    // 0. Clean up (Order matters due to FKs)
    await prisma.sessions.deleteMany({});
    await prisma.bookings.deleteMany({});
    await prisma.package_items.deleteMany({});
    await prisma.curriculum_subject_map.deleteMany({});

    await prisma.subjects.deleteMany({});
    await prisma.curricula.deleteMany({});
    await prisma.packages.deleteMany({});

    // 1. Subjects
    const subjects = [
        { id: 'math', name: 'Mathematics', canonical_code: 'MATH', description: 'K-12 Mathematics' },
        { id: 'science', name: 'Science', canonical_code: 'SCI', description: 'K-12 Science' },
        { id: 'english', name: 'English', canonical_code: 'ENG', description: 'K-12 English' },
    ];

    for (const s of subjects) {
        await prisma.subjects.upsert({
            where: { id: s.id },
            update: {},
            create: s,
        });
    }

    // 2. Curricula
    const curricula = [
        { id: 'ngss', name: 'NGSS', country: 'USA', description: 'Next Generation Science Standards' },
        { id: 'common_core', name: 'Common Core', country: 'USA', description: 'Common Core State Standards' },
        { id: 'cbse', name: 'CBSE', country: 'India', description: 'Central Board of Secondary Education' },
    ];

    for (const c of curricula) {
        await prisma.curricula.upsert({
            where: { id: c.id },
            update: {},
            create: c,
        });
    }

    // 3. Packages
    const packages = [
        { id: 'pkg_5hr', name: '5 Hours Math', price_cents: 50000, active: true },
        { id: 'pkg_10hr', name: '10 Hours Bundle', price_cents: 90000, active: true },
    ];

    for (const p of packages) {
        await prisma.packages.upsert({
            where: { id: p.id },
            update: {},
            create: p,
        });
    }

    console.log('Seeding completed.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
