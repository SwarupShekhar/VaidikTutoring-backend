import { Controller, Post, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin/seed-pricing')
export class SeedPricingController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async seedPricing() {
    console.log('🌱 Seeding pricing packages...');

    // US Packages
    const usPackages = [
      {
        id: 'us-foundation-package-id',
        name: 'Foundation (US)',
        description: '2 sessions per week - 8 monthly credits',
        price_cents: 19900,
        currency: 'USD',
        billing_type: 'subscription',
        active: true,
      },
      {
        id: 'us-mastery-package-id',
        name: 'Mastery (US)',
        description: '4 sessions per week - 16 monthly credits',
        price_cents: 34900,
        currency: 'USD',
        billing_type: 'subscription',
        active: true,
      },
      {
        id: 'us-elite-package-id',
        name: 'Elite (US)',
        description: '6 sessions per week - 24 monthly credits',
        price_cents: 49900,
        currency: 'USD',
        billing_type: 'subscription',
        active: true,
      },
    ];

    // UK Packages
    const ukPackages = [
      {
        id: 'uk-foundation-package-id',
        name: 'Foundation (UK)',
        description: '2 sessions per week - 8 monthly credits',
        price_cents: 14900,
        currency: 'GBP',
        billing_type: 'subscription',
        active: true,
      },
      {
        id: 'uk-mastery-package-id',
        name: 'Mastery (UK)',
        description: '4 sessions per week - 16 monthly credits',
        price_cents: 24900,
        currency: 'GBP',
        billing_type: 'subscription',
        active: true,
      },
      {
        id: 'uk-elite-package-id',
        name: 'Elite (UK)',
        description: '6 sessions per week - 24 monthly credits',
        price_cents: 37500,
        currency: 'GBP',
        billing_type: 'subscription',
        active: true,
      },
    ];

    try {
      // Insert US packages
      for (const pkg of usPackages) {
        await this.prisma.packages.upsert({
          where: { id: pkg.id },
          update: pkg,
          create: pkg,
        });
      }

      // Insert UK packages
      for (const pkg of ukPackages) {
        await this.prisma.packages.upsert({
          where: { id: pkg.id },
          update: pkg,
          create: pkg,
        });
      }

      console.log('✅ Pricing packages seeded successfully!');
      return { success: true, message: 'Pricing packages seeded successfully!' };
    } catch (error) {
      console.error('❌ Error seeding pricing:', error);
      return { success: false, message: 'Error seeding pricing packages', error: error.message };
    }
  }

  @Get()
  async getPackages() {
    const packages = await this.prisma.packages.findMany({
      where: { active: true },
      orderBy: { created_at: 'desc' },
    });
    return { packages };
  }
}
