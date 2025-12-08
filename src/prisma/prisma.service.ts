import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client.js';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as process from 'node:process';

/**
 * PrismaService wraps PrismaClient for Nest DI.
 * Uses PostgreSQL adapter for direct database connection (Prisma 7+).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor() {
    // Get database URL from environment
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Create PostgreSQL connection pool (must be done before super()) and set search_path to "app"
    const pool = new Pool({
      connectionString: databaseUrl,
      // Force the search_path so Prisma queries use the "app" schema instead of public
      options: '-c search_path=app',
    });

    // Create Prisma adapter for PostgreSQL
    const adapter = new PrismaPg(pool);

    // Pass adapter to PrismaClient constructor (must call super() before accessing 'this')
    super({ adapter });

    // Now we can assign to this.pool after super() has been called
    this.pool = pool;
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log('✅ Prisma: Successfully connected to database');
    } catch (error) {
      console.error('❌ Prisma: Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
