import { Controller, Get, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('stats')
    async getStats(@Req() req: any) {
        if (req.user.role !== 'admin') {
            throw new UnauthorizedException('Only admins can access stats.');
        }
        return this.adminService.getStats();
    }
}
