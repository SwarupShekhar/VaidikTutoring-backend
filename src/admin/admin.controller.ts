import { Body, Controller, Post, Get, UseGuards, Req, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Request } from 'express';

class CreateTutorDto {
    email!: string;
    first_name?: string;
    last_name?: string;
    password?: string;
    subjects?: string[];
}

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('stats')
    async getStats(@Req() req: any) {
        try {
            // Log user to debug 500
            console.log('GET /admin/stats - User:', req.user);

            if (!req.user || req.user.role !== 'admin') {
                throw new UnauthorizedException('Only admins can access stats.');
            }
            return await this.adminService.getStats();
        } catch (e) {
            console.error('GET /admin/stats failed:', e);
            throw e;
        }
    }

    @Post('tutors')
    @HttpCode(HttpStatus.CREATED)
    async createTutor(@Req() req: Request, @Body() dto: CreateTutorDto) {
        try {
            const actor = (req as any).user;
            if (!actor || actor.role !== 'admin') {
                throw new UnauthorizedException('Only admins can create tutor accounts.');
            }
            return await this.adminService.createTutor(actor, dto);
        } catch (e) {
            console.error('POST /admin/tutors failed:', e);
            throw e;
        }
    }
}
