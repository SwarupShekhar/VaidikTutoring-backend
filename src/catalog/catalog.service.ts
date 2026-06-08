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

    this.logger.debug('DB HIT: Fetching packages with dynamic pricing');
    const packages = await this.prisma.packages.findMany({
      where: { active: true },
      include: {
        package_items: true
      }
    });

    // Fetch exchange rates
    const rates = await this.prisma.exchange_rates.findMany();
    const rateMap = new Map(rates.map(r => [r.currency, Number(r.rate_to_usd)]));

    const processedPackages = packages.map(pkg => {
      let dynamicPriceCents = pkg.price_cents || 0;
      let finalCurrency = pkg.currency ?? 'USD';

      if (pkg.base_price_usd) {
        if (finalCurrency === 'USD') {
          dynamicPriceCents = pkg.base_price_usd * 100;
        } else {
          const rate = rateMap.get(finalCurrency);
          if (rate) {
            dynamicPriceCents = Math.round(pkg.base_price_usd * rate * 100);
          }
        }
      }

      // We override price_cents so the frontend gets the converted amount
      return {
        ...pkg,
        price_cents: dynamicPriceCents
      };
    });

    await this.cacheManager.set(cacheKey, processedPackages, 600000);
    return processedPackages;
  }
}
