import { Controller, Get, Param, UseGuards, UnauthorizedException, Req } from '@nestjs/common';
import { SchoolsService } from './schools.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Controller('admin/schools')
@UseGuards(JwtAuthGuard)
export class SchoolsController {
    constructor(private readonly schoolsService: SchoolsService) { }

    @Get(':id/dashboard')
    async getDashboard(@Req() req: any, @Param('id') id: string) {
        if (req.user.role !== 'admin') throw new UnauthorizedException('Admin only');
        return this.schoolsService.getSchoolDashboard(id);
    }

    @Get('me')
    async getMe(@Req() req: any) {
        // "School Admin" usually has role 'admin' or arguably 'tutor' if lead tutor?
        // Assuming any logged in user with school association might access this, or restrict to admin.
        // req.user.role check?
        return this.schoolsService.getSchoolProfile(req.user.userId);
    }

    @Get(':id/programs')
    async getPrograms(@Req() req: any, @Param('id') id: string) {
        // this.checkAdmin(req);
        return this.schoolsService.getSchoolPrograms(id);
    }
}
