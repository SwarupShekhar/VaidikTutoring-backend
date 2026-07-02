const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const sessions = await prisma.session.findMany({
        where: {
            meet_link: {
                startsWith: 'undefined/session/'
            }
        }
    });
    
    console.log(`Found ${sessions.length} corrupted sessions.`);
    
    for (const s of sessions) {
        const correctLink = s.meet_link.replace('undefined', 'https://studyhours.com');
        await prisma.session.update({
            where: { id: s.id },
            data: { meet_link: correctLink }
        });
        console.log(`Fixed session ${s.id} -> ${correctLink}`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
