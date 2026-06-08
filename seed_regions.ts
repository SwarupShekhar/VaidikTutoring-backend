import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const packageIds: Record<string, Record<string, string>> = {
    'Foundation': { 
        global: '47a32d16-64e0-4965-983b-3d0b84f331ad',
        uk: 'f47385ef-963d-4299-bb6e-2f54297a73e3',
        middleeast: 'da36d75d-8e6d-4786-9a25-9de7890f5d5e',
        australia: 'e1f22d16-64e0-4965-983b-3d0b84f331b0',
        singapore: 'c1d22d16-64e0-4965-983b-3d0b84f331b3',
        southafrica: '6a7b2d16-64e0-4965-983b-3d0b84f331b6'
    },
    'Mastery': { 
        global: '9b8c2d16-64e0-4965-983b-3d0b84f331ae',
        uk: '76fb2bd0-96f3-47ad-9a00-50284b7f4337',
        middleeast: '8d89045b-3814-4632-95f7-873b8852e690',
        australia: 'f2a32d16-64e0-4965-983b-3d0b84f331b1',
        singapore: 'd2e32d16-64e0-4965-983b-3d0b84f331b4',
        southafrica: '7b8c2d16-64e0-4965-983b-3d0b84f331b7'
    },
    'Elite': { 
        global: 'b3d42d16-64e0-4965-983b-3d0b84f331af',
        uk: '6f48a101-3820-4180-8b1e-25ba3194a0d9',
        middleeast: '5952f418-477c-4749-8086-5389476b7bd1',
        australia: 'a3b42d16-64e0-4965-983b-3d0b84f331b2',
        singapore: 'e3f42d16-64e0-4965-983b-3d0b84f331b5',
        southafrica: '8c9d2d16-64e0-4965-983b-3d0b84f331b8'
    }
  };

  const regions = [
    { code: 'global', currency: 'USD' },
    { code: 'uk', currency: 'GBP' },
    { code: 'australia', currency: 'AUD' },
    { code: 'singapore', currency: 'SGD' },
    { code: 'middleeast', currency: 'USD' }, 
    { code: 'southafrica', currency: 'ZAR' }
  ];

  const plans = [
    { name: 'Foundation', hours: 8, basePriceUsd: 149 },
    { name: 'Mastery', hours: 16, basePriceUsd: 249 },
    { name: 'Elite', hours: 25, basePriceUsd: 375 }
  ];

  for (const region of regions) {
    for (const plan of plans) {
      const id = packageIds[plan.name][region.code];
      
      await prisma.packages.upsert({
        where: { id },
        update: {
          base_price_usd: plan.basePriceUsd,
          currency: region.currency,
          price_cents: plan.basePriceUsd * 100, // fallback
          name: `${plan.name} (${region.code.toUpperCase()})`
        },
        create: {
          id,
          name: `${plan.name} (${region.code.toUpperCase()})`,
          description: `${plan.hours} sessions per month`,
          base_price_usd: plan.basePriceUsd,
          price_cents: plan.basePriceUsd * 100,
          currency: region.currency,
          billing_type: 'subscription',
          active: true
        }
      });

      // Add package item
      const existingItems = await prisma.package_items.findMany({ where: { package_id: id } });
      if (existingItems.length === 0) {
         const subject = await prisma.subjects.findFirst();
         if (subject) {
             await prisma.package_items.create({
                 data: {
                     package_id: id,
                     subject_id: subject.id,
                     hours: plan.hours,
                     note: 'Monthly credits'
                 }
             });
         }
      } else {
         await prisma.package_items.updateMany({
             where: { package_id: id },
             data: { hours: plan.hours }
         });
      }
    }
  }

  // Also manually fetch exchange rates once
  const response = await fetch('https://open.er-api.com/v6/latest/USD');
  const data = await response.json();
  
  if (data && data.rates) {
    for (const [currency, rate_to_usd] of Object.entries(data.rates)) {
      await prisma.exchange_rates.upsert({
        where: { currency },
        update: { rate_to_usd: Number(rate_to_usd), last_updated: new Date() },
        create: { currency, rate_to_usd: Number(rate_to_usd) }
      });
    }
    console.log('Exchange rates populated');
  }

  console.log('Done!');
}
main().catch(console.error).finally(() => { prisma.$disconnect(); pool.end(); });
