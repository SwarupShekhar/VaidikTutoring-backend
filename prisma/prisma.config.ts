// prisma.config.ts
import 'dotenv/config';

export default {
    // Datasource config for Migrate / CLI
    datasources: {
        db: {
            provider: 'postgresql',
            // Prisma CLI will read this URL for migrations and generation
            url: process.env.DATABASE_URL,
            // Ensure Prisma targets the `app` schema
            schemas: ['app'],
        },
    },

    // Optional: explicit Prisma Client options if you need them at runtime
    // The runtime PrismaClient can still accept client-side options in code.
} as const;