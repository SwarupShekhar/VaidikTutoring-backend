import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL;
// Fixed: Removed incompatible '-c search_path=app' option for Neon pooling
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Seeding data...');

    // 1. Subjects (Expanded & SEO Optimized)
    const subjectsList = [
        { name: 'Mathematics (Core)', description: 'Elementary, Middle School, Pre-Algebra, Algebra I & II.' },
        { name: 'Advanced Mathematics', description: 'Geometry, Trigonometry, Pre-Calculus, AP Calculus (AB & BC).' },
        { name: 'Science (Biology)', description: 'General Biology, Anatomy, Physiology, AP/IB Biology.' },
        { name: 'Science (Chemistry)', description: 'General Chemistry, Organic Chemistry, AP/IB Chemistry.' },
        { name: 'Science (Physics)', description: 'Mechanics, Electricity & Magnetism, AP/IB Physics.' },
        { name: 'English Language Arts', description: 'Reading Comprehension, Grammar, Literature Analysis.' },
        { name: 'Academic & Essay Writing', description: 'Research papers, critical thinking, college application essays.' },
        { name: 'World History', description: 'Global studies, European/Asian/African History.' },
        { name: 'U.S. History & Government', description: 'American Civics, Constitutional Studies, AP U.S. History.' },
        { name: 'Standardized Test Prep', description: 'SAT, ACT, PSAT, ISEE/SSAT preparation.' },
        { name: 'Computer Science & Coding', description: 'Python, Java, Scratch, Digital Literacy, AP CS.' },
        { name: 'Foreign Language (Spanish)', description: 'Beginner, Intermediate, and Advanced Spanish.' },
        { name: 'Foreign Language (French)', description: 'Beginner, Intermediate, and Advanced French.' },
        { name: 'Study Skills & Executive Function', description: 'Time management, organizational skills, test anxiety reduction.' },
    ];

    console.log(`Upserting ${subjectsList.length} subjects...`);
    for (const s of subjectsList) {
        // Generate a stable ID (slug) from the name
        const id = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        // Generate a canonical code (first 10 chars of slug, uppercase)
        const canonical_code = id.toUpperCase().substring(0, 50); // Increased length safety

        await prisma.subjects.upsert({
            where: { id },
            update: {
                name: s.name,
                description: s.description,
                canonical_code
            },
            create: {
                id,
                name: s.name,
                description: s.description,
                canonical_code
            },
        });
    }

    // 2. Curricula (Expanded & Globally Relevant)
    const curriculaList = [
        { id: 'IB', name: 'International Baccalaureate (PYP, MYP, DP)', country: 'International' },
        { id: 'IGCSE', name: 'International General Certificate of Secondary Education', country: 'International' },
        { id: 'CBSE', name: 'Central Board of Secondary Education (India)', country: 'India' },
        { id: 'CCSS', name: 'Common Core State Standards (U.S. K-12)', country: 'USA' },
        { id: 'NGSS', name: 'Next Generation Science Standards (U.S. Science)', country: 'USA' },
        { id: 'A-Levels', name: 'Advanced Level Qualifications (UK/Global)', country: 'UK' },
        { id: 'AP', name: 'Advanced Placement (College Board)', country: 'USA' },
        { id: 'TEKS', name: 'Texas Essential Knowledge and Skills (Texas, U.S.)', country: 'USA' },
        { id: 'Ontario', name: 'Ontario Provincial Curriculum (Canada)', country: 'Canada' },
    ];

    console.log(`Upserting ${curriculaList.length} curricula...`);
    for (const c of curriculaList) {
        const id = c.id.toLowerCase().replace(/[^a-z0-9]+/g, '_'); // safe slug id
        await prisma.curricula.upsert({
            where: { id },
            update: {
                name: c.name,
                country: c.country,
                description: c.name // Use name as description if not provided separately
            },
            create: {
                id,
                name: c.name,
                country: c.country,
                description: c.name
            },
        });
    }

    // 3. Packages (Tiered Pricing)
    const packagesList = [
        { name: 'Starter', hours: 5, price: 150, description: 'Ideal for specific homework help or short-term skill boosts.' },
        { name: 'Pro', hours: 10, price: 280, description: 'Our most popular option for consistent weekly support. (Saves $20)' },
        { name: 'Master', hours: 20, price: 500, description: 'Best value for long-term academic development and comprehensive subject mastery. (Saves $100)' },
    ];

    console.log(`Upserting ${packagesList.length} packages...`);
    for (const p of packagesList) {
        const id = p.name.toLowerCase();
        const price_cents = p.price * 100; // Convert dollars to cents

        await prisma.packages.upsert({
            where: { id },
            update: {
                name: p.name,
                price_cents: price_cents,
                description: p.description,
                active: true
            },
            create: {
                id,
                name: p.name,
                price_cents: price_cents,
                description: p.description,
                currency: 'USD',
                active: true,
                billing_type: 'prepaid'
            },
        });

        // Also create related package items if needed (optional logic, keeping simple for now)
        // Note: The original requirement didn't specify package items (relationships to subjects), 
        // so we treat packages as generic credit bundles.
    }

    // 4. Admin Seeding (Super Admin)
    const passwordHash = await bcrypt.hash('Vaidik@1234', 10);
    const adminEmail = 'swarupshekhar.vaidikedu@gmail.com';

    console.log(`Upserting Admin: ${adminEmail}...`);
    await prisma.users.upsert({
        where: { email: adminEmail },
        update: { role: 'admin', password_hash: passwordHash },
        create: {
            email: adminEmail,
            first_name: 'Swarup',
            last_name: 'Shekhar',
            password_hash: passwordHash,
            role: 'admin',
            is_active: true
        },
    });
    console.log('Admin seeded.');

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