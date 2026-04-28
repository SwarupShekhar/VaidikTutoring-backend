import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getSubjects() {
    const cacheKey = 'catalog_subjects';
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    this.logger.debug('DB HIT: Fetching subjects');
    const data = await this.prisma.subjects.findMany();
    await this.cacheManager.set(cacheKey, data, 600000); // 10 mins
    return data;
  }

  async getCurricula() {
    const cacheKey = 'catalog_curricula';
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    this.logger.debug('DB HIT: Fetching curricula');
    const data = await this.prisma.curricula.findMany();
    await this.cacheManager.set(cacheKey, data, 600000);
    return data;
  }

  async getPackages() {
    const cacheKey = 'catalog_packages';
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    this.logger.debug('DB HIT: Fetching packages');
    const data = await this.prisma.packages.findMany({
      where: { active: true },
    });
    await this.cacheManager.set(cacheKey, data, 600000);
    return data;
  }
}
