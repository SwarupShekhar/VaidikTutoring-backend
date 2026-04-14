import { Module } from '@nestjs/common';
import { BlogsService } from './blogs.service';
import { BlogsController } from './blogs.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [PrismaModule, AuthModule, StorageModule],
    controllers: [BlogsController],
    providers: [BlogsService],
})
export class BlogsModule { }
