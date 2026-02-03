import { Module } from '@nestjs/common';
import { BlogsService } from './blogs.service.js';
import { BlogsController } from './blogs.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [BlogsController],
    providers: [BlogsService],
})
export class BlogsModule { }
