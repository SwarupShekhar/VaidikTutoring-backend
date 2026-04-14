import { Controller, Post, Get, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

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
        id: 'da36d75d-8e6d-4786-9a25-9de7890f5d5e',
        name: 'Foundation (US)',
        description: '2 sessions per week - 8 monthly credits',
        price_cents: 19900,
        currency: 'USD',
        billing_type: 'subscription',
        active: true,
      },
      {
        id: '8d89045b-3814-4632-95f7-873b8852e690',
        name: 'Mastery (US)',
        description: '4 sessions per week - 16 monthly credits',
        price_cents: 34900,
        currency: 'USD',
        billing_type: 'subscription',
        active: true,
      },
      {
        id: '5952f418-477c-4749-8086-5389476b7bd1',
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
        id: 'f47385ef-963d-4299-bb6e-2f54297a73e3',
        name: 'Foundation (UK)',
        description: '2 sessions per week - 8 monthly credits',
        price_cents: 14900,
        currency: 'GBP',
        billing_type: 'subscription',
        active: true,
      },
      {
        id: '76fb2bd0-96f3-47ad-9a00-50284b7f4337',
        name: 'Mastery (UK)',
        description: '4 sessions per week - 16 monthly credits',
        price_cents: 24900,
        currency: 'GBP',
        billing_type: 'subscription',
        active: true,
      },
      {
        id: '6f48a101-3820-4180-8b1e-25ba3194a0d9',
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
