import { Module } from '@nestjs/common';
import { InviteService } from './invite.service.js';
import { InviteController } from './invite.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  providers: [InviteService],
  controllers: [InviteController],
  exports: [InviteService],
})
export class InviteModule {}
