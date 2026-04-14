import { Injectable } from '@nestjs/common';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SyncClerkMetadataService } from '../../admin/sync-clerk-metadata';

@Injectable()
export class JwtAuthGuard extends ClerkAuthGuard {
    constructor(prisma: PrismaService, jwtService: JwtService, syncClerkService: SyncClerkMetadataService) {
        super(prisma, jwtService, syncClerkService);
    }
}
