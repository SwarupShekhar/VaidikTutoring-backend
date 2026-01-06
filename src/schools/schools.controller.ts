import { Controller, Get, Param, UseGuards, UnauthorizedException, Req } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('admin/schools')
@UseGuards(JwtAuthGuard)
export class SchoolsController {
    constructor(private readonly schoolsService: SchoolsService) { }

    @Get(':id/dashboard')
    async getDashboard(@Req() req: any, @Param('id') id: string) {
        if (req.user.role !== 'admin') throw new UnauthorizedException('Admin only');
        return this.schoolsService.getSchoolDashboard(id);
    }
}
