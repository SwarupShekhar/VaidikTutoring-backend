import { Body, Controller, Post, Get, UseGuards, Req, HttpCode, HttpStatus, UnauthorizedException, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { IsEmail, IsOptional, IsString, IsArray, MinLength, IsUUID } from 'class-validator';
import { Request } from 'express';

class CreateTutorDto {
    @IsEmail()
    email!: string;

    @IsOptional()
    @IsString()
    first_name?: string;

    @IsOptional()
    @IsString()
    last_name?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    subjects?: string[];
}

class AllocateTutorDto {
    @IsUUID()
    studentId!: string;

    @IsUUID()
    tutorId!: string;

    @IsString()
    subjectId!: string;
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

    @Get('tutors')
    async getTutors(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
        try {
            const actor = req.user;
            if (!actor || actor.role !== 'admin') {
                throw new UnauthorizedException('Only admins can view tutors.');
            }
            const pageNum = parseInt(page || '1', 10);
            const limitNum = parseInt(limit || '50', 10);
            return await this.adminService.getTutors(pageNum, limitNum);
        } catch (e) {
            console.error('GET /admin/tutors failed:', e);
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

    @Get('students')
    async getStudents(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
        try {
            const actor = req.user;
            if (!actor || actor.role !== 'admin') {
                throw new UnauthorizedException('Only admins can view students.');
            }
            const pageNum = parseInt(page || '1', 10);
            const limitNum = parseInt(limit || '50', 10);
            return await this.adminService.getStudents(pageNum, limitNum);
        } catch (e) {
            console.error('GET /admin/students failed:', e);
            throw e;
        }
    }

    @Post('allocations')
    @HttpCode(HttpStatus.CREATED)
    async allocateTutor(@Req() req: Request, @Body() dto: AllocateTutorDto) {
        try {
            const actor = (req as any).user;
            if (!actor || actor.role !== 'admin') {
                throw new UnauthorizedException('Only admins can allocate tutors.');
            }
            return await this.adminService.allocateTutor(dto.studentId, dto.tutorId, dto.subjectId);
        } catch (e) {
            console.error('POST /admin/allocations failed:', e);
            throw e;
        }
    }
}
