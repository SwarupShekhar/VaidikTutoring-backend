import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient();

async function main() {
    const email = process.argv[2];
    if (!email) {
        console.error('Please provide an email address as the first argument.');
        process.exit(1);
    }

    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) {
        console.error(`User with email ${email} not found.`);
        process.exit(1);
    }

    await prisma.users.update({
        where: { id: user.id },
        data: {
            email_verified: true,
            email_verification_token: null,
            email_verification_expires: null,
        },
    });

    console.log(`Successfully manually verified email for user: ${email}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
