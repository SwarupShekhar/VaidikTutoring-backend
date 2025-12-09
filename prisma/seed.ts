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
    // We wrap these in try/catch in case tables are already empty or don't exist yet
    try {
        await prisma.bookings.deleteMany({});
    } catch (e) { }

    // We delete others if needed, but be careful with foreign keys. 
    // Usually standard upsert is safer than deleteMany if you have live data.
    // Uncomment these if you want a hard reset:
    /*
    await prisma.sessions.deleteMany({});
    await prisma.package_items.deleteMany({});
    await prisma.curriculum_subject_map.deleteMany({});
    await prisma.subjects.deleteMany({});
    await prisma.curricula.deleteMany({});
    await prisma.packages.deleteMany({});
    */

    // 1. Subjects
    // We map your simple list to include the required 'canonical_code' and 'description'
    const simpleSubjects = [
        // Core academics
        { id: 'math', name: 'Mathematics' },
        { id: 'english', name: 'English Language Arts' },
        { id: 'science', name: 'General Science' },
        { id: 'social_studies', name: 'Social Studies' },

        // Sciences
        { id: 'physics', name: 'Physics' },
        { id: 'chemistry', name: 'Chemistry' },
        { id: 'biology', name: 'Biology' },
        { id: 'environmental_science', name: 'Environmental Science' },
        { id: 'earth_science', name: 'Earth & Space Science' },

        // Mathematics – advanced
        { id: 'algebra', name: 'Algebra' },
        { id: 'geometry', name: 'Geometry' },
        { id: 'trigonometry', name: 'Trigonometry' },
        { id: 'precalculus', name: 'Pre-Calculus' },
        { id: 'calculus', name: 'Calculus' },
        { id: 'statistics', name: 'Statistics & Probability' },

        // Humanities
        { id: 'history', name: 'History' },
        { id: 'world_history', name: 'World History' },
        { id: 'geography', name: 'Geography' },
        { id: 'civics', name: 'Civics & Government' },
        { id: 'economics', name: 'Economics' },
        { id: 'philosophy', name: 'Philosophy' },

        // Languages
        { id: 'spanish', name: 'Spanish' },
        { id: 'french', name: 'French' },
        { id: 'german', name: 'German' },
        { id: 'mandarin', name: 'Mandarin Chinese' },
        { id: 'hindi', name: 'Hindi' },
        { id: 'arabic', name: 'Arabic' },

        // Computer & technology
        { id: 'coding', name: 'Computer Science & Coding' },
        { id: 'python', name: 'Python' },
        { id: 'javascript', name: 'JavaScript' },
        { id: 'web_dev', name: 'Web Development' },
        { id: 'data_science', name: 'Data Science' },
        { id: 'ai_basics', name: 'AI Basics' },

        // Creative subjects
        { id: 'art', name: 'Art & Design' },
        { id: 'music', name: 'Music' },
        { id: 'drama', name: 'Drama & Theatre' },
        { id: 'creative_writing', name: 'Creative Writing' },

        // Skills & enrichment
        { id: 'public_speaking', name: 'Public Speaking' },
        { id: 'critical_thinking', name: 'Critical Thinking' },
        { id: 'study_skills', name: 'Study Skills' }
    ];

    for (const s of simpleSubjects) {
        await prisma.subjects.upsert({
            where: { id: s.id },
            update: {
                name: s.name,
                // Ensure these fields exist if they are missing
                canonical_code: s.id.toUpperCase().substring(0, 10),
                description: s.name
            },
            create: {
                id: s.id,
                name: s.name,
                canonical_code: s.id.toUpperCase().substring(0, 10),
                description: s.name
            },
        });
    }

    // 2. Curricula
    const simpleCurricula = [
        { id: 'ccss', name: 'Common Core (USA)', country: 'USA' },
        { id: 'ngss', name: 'NGSS (USA)', country: 'USA' },
        { id: 'ap', name: 'Advanced Placement (AP)', country: 'USA' },

        { id: 'ib_pyp', name: 'IB Primary Years (PYP)', country: 'International' },
        { id: 'ib_myp', name: 'IB Middle Years (MYP)', country: 'International' },
        { id: 'ib_dp', name: 'IB Diploma (DP)', country: 'International' },

        { id: 'igcse', name: 'Cambridge IGCSE', country: 'UK' },
        { id: 'gcse', name: 'GCSE', country: 'UK' },
        { id: 'a_levels', name: 'A-Levels', country: 'UK' },

        { id: 'cbse', name: 'CBSE', country: 'India' },
        { id: 'icse', name: 'ICSE', country: 'India' },
        { id: 'state_boards_india', name: 'Indian State Boards', country: 'India' },

        { id: 'australian', name: 'Australian Curriculum', country: 'Australia' },
        { id: 'ontario', name: 'Ontario Curriculum', country: 'Canada' },

        { id: 'uae_moe', name: 'UAE Ministry of Education', country: 'UAE' },
        { id: 'american', name: 'American Curriculum', country: 'International' },
        { id: 'british', name: 'British Curriculum', country: 'International' },

        { id: 'homeschool', name: 'Homeschooling', country: 'Global' },
        { id: 'custom', name: 'Custom / Other', country: 'Global' }
    ];

    for (const c of simpleCurricula) {
        await prisma.curricula.upsert({
            where: { id: c.id },
            update: {
                name: c.name,
                country: c.country,
                description: c.name
            },
            create: {
                id: c.id,
                name: c.name,
                country: c.country,
                description: c.name
            },
        });
    }

    // 3. Packages (Preserving your existing ones)
    const packages = [
        { id: 'pkg_trial', name: 'Trial Session (30 min)', price_cents: 0, active: true, currency: 'USD' },
        { id: 'pkg_1hr', name: 'Single Session (1 Hr)', price_cents: 4500, active: true, currency: 'USD' },
        { id: 'pkg_5hr', name: '5 Hours Bundle', price_cents: 20000, active: true, currency: 'USD' },
        { id: 'pkg_10hr', name: '10 Hours Bundle', price_cents: 38000, active: true, currency: 'USD' },
    ];

    for (const p of packages) {
        await prisma.packages.upsert({
            where: { id: p.id },
            update: {
                name: p.name,
                price_cents: p.price_cents,
                active: p.active
            },
            create: {
                id: p.id,
                name: p.name,
                price_cents: p.price_cents,
                active: p.active,
                currency: p.currency || 'USD'
            },
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