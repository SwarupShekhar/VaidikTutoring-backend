import { Module } from '@nestjs/common';
import { BlogsService } from './blogs.service.js';
import { BlogsController } from './blogs.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
    imports: [PrismaModule, AuthModule, StorageModule],
    controllers: [BlogsController],
    providers: [BlogsService],
})
export class BlogsModule { }
