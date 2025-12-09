import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
    constructor(private prisma: PrismaService) { }

    async getSubjects() {
        return this.prisma.subjects.findMany();
    }

    async getCurricula() {
        return this.prisma.curricula.findMany();
    }

    async getPackages() {
        return this.prisma.packages.findMany({
            where: { active: true }
        });
    }
}
