import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CreditsController } from './credits.controller';
import { CreditsService } from './credits.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret',
      signOptions: { expiresIn: '1d' },
    }),
    PrismaModule,
  ],
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
