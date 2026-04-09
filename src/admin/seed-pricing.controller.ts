import { Controller, Post, Get, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Controller('admin/seed-pricing')
@UseGuards(JwtAuthGuard)
export class SeedPricingController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async seedPricing(@Req() req: any) {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') {
      throw new UnauthorizedException('Only admins can seed pricing data.');
    }

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
      for (const pkg of usPackages) {
        await this.prisma.packages.upsert({ where: { id: pkg.id }, update: pkg, create: pkg });
      }
      for (const pkg of ukPackages) {
        await this.prisma.packages.upsert({ where: { id: pkg.id }, update: pkg, create: pkg });
      }
      return { success: true, message: 'Pricing packages seeded successfully!' };
    } catch (error) {
      return { success: false, message: 'Error seeding pricing packages', error: error.message };
    }
  }

  @Get()
  async getPackages(@Req() req: any) {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') {
      throw new UnauthorizedException('Only admins can view pricing data.');
    }
    const packages = await this.prisma.packages.findMany({
      where: { active: true },
      orderBy: { created_at: 'desc' },
    });
    return { packages };
  }
}
