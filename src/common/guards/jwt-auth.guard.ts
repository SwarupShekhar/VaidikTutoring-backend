import { Injectable } from '@nestjs/common';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard extends ClerkAuthGuard {
    constructor(prisma: PrismaService, jwtService: JwtService) {
        super(prisma, jwtService);
    }
}
