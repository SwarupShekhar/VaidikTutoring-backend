import { Controller, Post, Get, Body, Req, UseGuards, ForbiddenException, Param } from '@nestjs/common';
import { ParentService } from './parent.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';

@Controller('parent')
@UseGuards(ClerkAuthGuard, RolesGuard)
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

    @Get('children/:childId/sessions')
    async getChildSessions(
        @Req() req: any,
        @Param('childId') childId: string
    ) {
        return this.parentService.getChildSessions(req.user.userId, childId);
    }
}
