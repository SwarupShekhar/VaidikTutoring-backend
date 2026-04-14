import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getHello(): string {
    return 'StudyHours API v1 - Online';
  }

  @Get('health')
  simpleHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('debug-sentry')
  debugSentry() {
    throw new Error('My first Sentry error!');
  }

  @Get('health/db')
  async health() {
    try {
      // lightweight connection check
      await this.prisma.$queryRaw`SELECT 1`;
      // explicit schema-qualified check for users table count
      const rows: any = await this.prisma
        .$queryRaw`SELECT count(*)::int as count FROM "app"."users";`;
      const userCount =
        Array.isArray(rows) && rows[0] ? Number(rows[0].count || 0) : 0;
      return {
        status: 'connected',
        message: 'Database connected',
        timestamp: new Date().toISOString(),
        tablesExist: true,
        userCount,
      };
    } catch (e: any) {
      return {
        status: 'disconnected',
        message: 'Database connection failed',
        error: e?.message || String(e),
        timestamp: new Date().toISOString(),
        tablesExist: false,
      };
    }
  }
}
