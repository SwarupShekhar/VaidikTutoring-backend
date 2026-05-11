import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
