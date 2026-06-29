import { Global, Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SeedPricingController } from './seed-pricing.controller';
import { SyncClerkMetadataService } from './sync-clerk-metadata';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AzureModule } from '../azure/azure.module';
import { LeadsModule } from '../leads/leads.module';
import { ZoomModule } from '../zoom/zoom.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    EmailModule,
    AzureModule,
    LeadsModule,
    ZoomModule,
  ],
  controllers: [AdminController, SeedPricingController],
  providers: [AdminService, SyncClerkMetadataService],
  exports: [AdminService, SyncClerkMetadataService],
})
export class AdminModule {}
