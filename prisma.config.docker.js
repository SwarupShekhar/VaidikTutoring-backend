/**
 * Docker-specific Prisma config file.
 * Uses plain CommonJS (module.exports) so Prisma v7 can parse it
 * without TypeScript compilation or ESM interop issues.
 */
require("dotenv/config");
const { defineConfig } = require("@prisma/config");

function getDirectUrl() {
  const directUrl = process.env.DIRECT_URL;
  if (directUrl) {
    console.log("✅ Using DIRECT_URL for migrations");
    return directUrl;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Either DIRECT_URL or DATABASE_URL must be set");
  }

  // Convert pooled URL to direct URL by removing '-pooler'
  const derived = databaseUrl.replace(/-pooler\./, ".");
  console.log("⚠️  DIRECT_URL not set, derived from DATABASE_URL");
  return derived;
}

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: getDirectUrl(),
  },
});
