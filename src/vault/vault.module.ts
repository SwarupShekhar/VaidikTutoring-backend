import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AzureModule } from '../azure/azure.module';

@Module({
  imports: [PrismaModule, AzureModule],
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
