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
        if (req.user.role !== 'admin') {
            throw new UnauthorizedException('Only admins can access stats.');
        }
        return this.adminService.getStats();
    }

    @Post('tutors')
    @HttpCode(HttpStatus.CREATED)
    async createTutor(@Req() req: Request, @Body() dto: CreateTutorDto) {
        const actor = (req as any).user;
        if (actor.role !== 'admin') {
            throw new UnauthorizedException('Only admins can create tutor accounts.');
        }
        return this.adminService.createTutor(actor, dto);
    }
}
