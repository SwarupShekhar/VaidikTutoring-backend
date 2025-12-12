// src/auth/admin-tutors.controller.ts
import { Body, Controller, Post, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AdminTutorsService } from './admin-tutors.service.js';
import { Request } from 'express';

class CreateTutorDto {
    email!: string;
    first_name?: string;
    last_name?: string;
    password?: string;
    subjects?: string[];

}

@Controller('auth/admin')
export class AdminTutorsController {
    constructor(private readonly svc: AdminTutorsService) { }

    // Protect this endpoint with JWT guard; the service checks role === 'admin'
    @UseGuards(JwtAuthGuard)
    @Post('tutors')
    @HttpCode(HttpStatus.CREATED)
    async createTutor(@Req() req: Request, @Body() dto: CreateTutorDto) {
        // req.user should be present from the JwtAuthGuard
        const actor = (req as any).user;
        return this.svc.createTutor(actor, dto);
    }
}