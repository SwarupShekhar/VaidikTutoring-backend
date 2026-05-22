import { Module } from '@nestjs/common';
import { SanityService } from './sanity.service';
import { CmsController } from './cms.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CmsController],
  providers: [SanityService],
  exports: [SanityService],
})
export class CmsModule {}
