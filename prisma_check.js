require('dotenv').config();
try {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    try {
      await p.$connect();
      const rows = await p.$queryRaw`SELECT count(*)::int as count FROM app.users`;
      console.log('RAW COUNT RESULT ->', JSON.stringify(rows, null, 2));
    } catch (err) {
      console.error('PRISMA DIRECT ERROR ->', err);
    } finally {
      try { await p.$disconnect(); } catch (_) {}
    }
  })();
} catch (e) {
  console.error('CANNOT REQUIRE @prisma/client ->', e && e.message ? e.message : e);
  process.exit(1);
}
