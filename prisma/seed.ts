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

    // 5. Test Data (Fake Users & Sessions for Dashboard)
    console.log('Seeding test data for stats...');

    // Fake Parent
    const parentEmail = 'parent@demo.com';
    const parent = await prisma.users.upsert({
        where: { email: parentEmail },
        update: {},
        create: {
            email: parentEmail,
            password_hash: passwordHash,
            role: 'parent',
            first_name: 'John',
            last_name: 'Doe',
            is_active: true
        }
    });

    // Fake Student
    const studentEmail = 'student@demo.com';
    const studentUser = await prisma.users.upsert({
        where: { email: studentEmail },
        update: {},
        create: {
            email: studentEmail,
            password_hash: passwordHash,
            role: 'student',
            first_name: 'Jane',
            last_name: 'Doe',
            is_active: true
        }
    });

    // Link Student Profile
    const existingProfile = await prisma.students.findFirst({
        where: { user_id: studentUser.id }
    });

    let studentProfile;
    if (!existingProfile) {
        studentProfile = await prisma.students.create({
            data: {
                user_id: studentUser.id,
                parent_user_id: parent.id,
                first_name: 'Jane',
                last_name: 'Doe',
                grade: '10'
            }
        });
    } else {
        studentProfile = existingProfile;
    }

    // Fake Booking & Session (Future)
    const mathSubject = subjectsList[0];
    const starterPackage = packagesList[0];

    // Check if booking exists for this student/subject/package combo
    const mathSlug = mathSubject.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const bookingExists = await prisma.bookings.findFirst({
        where: {
            student_id: studentProfile.id,
            subject_id: mathSlug,
            package_id: starterPackage.name.toLowerCase()
        }
    });

    if (!bookingExists) {
        // Also check if ANY booking exists for this time slot (more robust)
        const conflict = await prisma.bookings.findFirst({
            where: {
                student_id: studentProfile.id,
                requested_start: new Date(Date.now() + 86400000)
            }
        });

        if (!conflict) {
            const booking = await prisma.bookings.create({
                data: {
                    student_id: studentProfile.id,
                    subject_id: mathSlug,
                    package_id: starterPackage.name.toLowerCase(),
                    status: 'confirmed',
                    requested_start: new Date(Date.now() + 86400000), // +1 day
                    requested_end: new Date(Date.now() + 86400000 + 3600000)
                }
            });

            await prisma.sessions.create({
                data: {
                    booking_id: booking.id,
                    start_time: new Date(Date.now() + 86400000),
                    end_time: new Date(Date.now() + 86400000 + 3600000),
                    status: 'scheduled',
                    meet_link: `https://meet.jit.si/k12-${booking.id}`
                }
            });
            console.log('Test booking and session created.');
        } else {
            console.log('Conflicting test booking found (skipping).');
        }
    } else {
        console.log('Test booking already exists (skipping duplicates).');
    }

    console.log('Test data seeded (1 Parent, 1 Student, 1 Future Session).');

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