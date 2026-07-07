import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const syncClerkService = app.get(SyncClerkMetadataService);

  console.log('[Script] Starting Clerk roles backfill...');

  const users = await prisma.users.findMany({
    where: {
      role: { in: ['student', 'parent', 'tutor', 'admin'] },
    },
    select: {
      id: true,
      email: true,
      role: true,
    }
  });

  console.log(`[Script] Found ${users.length} users with roles.`);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await syncClerkService.syncUserRoleToClerk(user.id, user.role);
      synced++;
    } catch (err: any) {
      if (err.message && err.message.includes('Clerk user not found')) {
        console.log(`[Script] Skipped user ${user.email}: No Clerk identity found.`);
        skipped++;
      } else {
        console.error(`[Script] Failed user ${user.email}:`, err);
        failed++;
      }
    }
    // Rate limit sleep (Clerk API limit) - 50ms per request is safe
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('\n[Script] Backfill Summary:');
  console.log(`Total: ${users.length}`);
  console.log(`Synced: ${synced}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  await app.close();
  process.exit(0);
}

bootstrap().catch(err => {
  console.error('[Script] Fatal Error:', err);
  process.exit(1);
});
