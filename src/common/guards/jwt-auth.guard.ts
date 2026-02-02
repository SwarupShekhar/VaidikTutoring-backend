import { Injectable } from '@nestjs/common';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class JwtAuthGuard extends ClerkAuthGuard {
    constructor(prisma: PrismaService) {
        super(prisma);
    }
}
