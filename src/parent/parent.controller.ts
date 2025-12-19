import { Controller, Post, Get, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ParentService } from './parent.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';

@Controller('parent')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('parent')
export class ParentController {
    constructor(private readonly parentService: ParentService) { }

    @Post('students')
    async createStudent(@Req() req, @Body() dto: { name: string; grade: string; email?: string }) {
        return this.parentService.createStudent(req.user.userId, dto);
    }

    @Get('students')
    async getStudents(@Req() req) {
        return this.parentService.getChildren(req.user.userId);
    }
}
