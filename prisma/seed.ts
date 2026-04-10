import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
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

    // 3. Packages (Regional Tiered Pricing)
    const packagesList = [
        // US Region
        { id: 'da36d75d-8e6d-4786-9a25-9de7890f5d5e', name: 'Foundation (US)', hours: 8, price: 199, currency: 'USD', region: 'US' },
        { id: '8d89045b-3814-4632-95f7-873b8852e690', name: 'Mastery (US)', hours: 16, price: 349, currency: 'USD', region: 'US' },
        { id: '5952f418-477c-4749-8086-5389476b7bd1', name: 'Elite (US)', hours: 24, price: 499, currency: 'USD', region: 'US' },
        
        // UK Region
        { id: 'f47385ef-963d-4299-bb6e-2f54297a73e3', name: 'Foundation (UK)', hours: 8, price: 149, currency: 'GBP', region: 'UK' },
        { id: '76fb2bd0-96f3-47ad-9a00-50284b7f4337', name: 'Mastery (UK)', hours: 16, price: 249, currency: 'GBP', region: 'UK' },
        { id: '6f48a101-3820-4180-8b1e-25ba3194a0d9', name: 'Elite (UK)', hours: 24, price: 375, currency: 'GBP', region: 'UK' },
    ];

    console.log(`Upserting ${packagesList.length} regional packages...`);
    for (const p of packagesList) {
        const price_cents = p.price * 100; // Convert to cents/pence

        const pkg = await prisma.packages.upsert({
            where: { id: p.id },
            update: {
                name: p.name,
                price_cents: price_cents,
                currency: p.currency,
                active: true,
                description: `${p.hours} hours of private tutoring sessions.`
            },
            create: {
                id: p.id,
                name: p.name,
                price_cents: price_cents,
                currency: p.currency,
                description: `${p.hours} hours of private tutoring sessions.`,
                active: true,
                billing_type: 'subscription'
            },
        });

        // Create a generic package item to represent the credits
        await prisma.package_items.create({
            data: {
                package_id: pkg.id,
                hours: p.hours,
                note: 'Monthly credit allocation'
            }
        });
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