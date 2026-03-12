import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SeedPricingController } from './seed-pricing.controller';
import { SyncClerkMetadataService } from './sync-clerk-metadata';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'secret' }),
    EmailModule,
  ],
  controllers: [AdminController, SeedPricingController],
  providers: [AdminService, SyncClerkMetadataService],
  exports: [AdminService, SyncClerkMetadataService],
})
export class AdminModule {}
