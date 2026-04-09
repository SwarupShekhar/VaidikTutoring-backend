import {
  Body,
  Controller,
  Logger,
  Post,
  Get,
  Delete,
  UseGuards,
  Req,
  Param,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Query,
  Patch,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { SyncClerkMetadataService } from './sync-clerk-metadata.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsArray,
  MinLength,
  IsUUID,
} from 'class-validator';
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

  @IsOptional()
  @IsUUID()
  bookingId?: string;
}

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly syncClerkService: SyncClerkMetadataService
  ) { }

  @Get('stats')
  async getStats(@Req() req: any) {
    try {
      const actor = req.user;
      if (!actor || actor.role !== 'admin') {
        throw new UnauthorizedException('Only admins can access stats.');
      }
      return await this.adminService.getStats();
    } catch (e) {
      this.logger.error('GET /admin/stats failed', e);
      throw e;
    }
  }

  @Get('tutors')
  async getTutors(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const actor = req.user;
      if (!actor || actor.role !== 'admin') {
        throw new UnauthorizedException('Only admins can view tutors.');
      }
      const pageNum = parseInt(page || '1', 10);
      const limitNum = parseInt(limit || '1000', 10); // Default to large number to get all
      const result = await this.adminService.getTutors(pageNum, limitNum);

      // If no pagination params provided, return just the array for backward compatibility
      // FORCE FIX: Always return array to prevent frontend crash
      return result.data;
    } catch (e) {
      this.logger.error('GET /admin/tutors failed', e);
      throw e;
    }
  }

  @Post('tutors')
  @HttpCode(HttpStatus.CREATED)
  async createTutor(@Req() req: any, @Body() dto: CreateTutorDto) {
    try {
      const actor = (req as any).user;
      if (!actor || actor.role !== 'admin') {
        throw new UnauthorizedException(
          'Only admins can create tutor accounts.',
        );
      }
      return await this.adminService.createTutor(actor, dto);
    } catch (e) {
      this.logger.error('POST /admin/tutors failed', e);
      throw e;
    }
  }

  @Get('students')
  async getStudents(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const actor = req.user;
      if (!actor || actor.role !== 'admin') {
        throw new UnauthorizedException('Only admins can view students.');
      }
      const pageNum = parseInt(page || '1', 10);
      const limitNum = parseInt(limit || '1000', 10); // Default to large number to get all
      const result = await this.adminService.getStudents(pageNum, limitNum);

      // If no pagination params provided, return just the array for backward compatibility
      // FORCE FIX: Always return array to prevent frontend crash
      return result.data;
    } catch (e) {
      this.logger.error('GET /admin/students failed', e);
      throw e;
    }
  }

  @Get('bookings')
  async getBookings(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const actor = req.user;
      if (!actor || actor.role !== 'admin') {
        throw new UnauthorizedException('Only admins can view bookings.');
      }
      const pageNum = parseInt(page || '1', 10);
      const limitNum = parseInt(limit || '50', 10);
      const result = await this.adminService.getBookings(pageNum, limitNum);
      return result.data;
    } catch (e) {
      this.logger.error('GET /admin/bookings failed', e);
      throw e;
    }
  }

  @Get('allocations/queue')
  async getAllocationQueue(@Req() req: any) {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') {
      throw new UnauthorizedException('Admin only');
    }
    return this.adminService.getAllocationQueue();
  }

  @Get('allocations/recommendations/:subjectId')
  async getTutorRecommendations(@Req() req: any, @Param('subjectId') subjectId: string) {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') {
      throw new UnauthorizedException('Admin only');
    }
    return this.adminService.getTutorRecommendations(subjectId);
  }

  @Post('allocations')
  @HttpCode(HttpStatus.CREATED)
  async allocateTutor(@Req() req: any, @Body() dto: AllocateTutorDto) {
    try {
      const actor = (req as any).user;
      if (!actor || actor.role !== 'admin') {
        throw new UnauthorizedException('Only admins can allocate tutors.');
      }
      return await this.adminService.allocateTutor(
        dto.studentId,
        dto.tutorId,
        dto.subjectId,
        dto.bookingId,
      );
    } catch (e) {
      this.logger.error('POST /admin/allocations failed', e);
      throw e;
    }
  }

  @Patch('bookings/:id/assign-tutor')
  @HttpCode(HttpStatus.OK)
  async assignTutorToBooking(
    @Req() req: any,
    @Param('id') bookingId: string,
    @Body('tutorId') tutorId: string,
  ) {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') {
      throw new UnauthorizedException('Admin only');
    }
    return this.adminService.assignTutorToBooking(bookingId, tutorId);
  }

  @Delete('tutors/:id')
  async removeTutor(@Req() req: any, @Param('id') id: string) {
    try {
      const actor = (req as any).user;
      if (!actor || actor.role !== 'admin') {
        throw new UnauthorizedException('Only admins can delete tutors.');
      }
      return await this.adminService.removeTutor(id);
    } catch (e) {
      this.logger.error('DELETE /admin/tutors/:id failed', e);
      throw e;
    }
  }

  @Post('tutors/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetTutorPassword(@Req() req: any, @Param('id') id: string) {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') throw new UnauthorizedException('Admin only');
    return this.adminService.resetTutorPassword(id);
  }

  @Post('tutors/:id/suspend')
  async suspendTutor(@Req() req: any, @Param('id') id: string, @Body('reason') reason?: string) {
    const actor = (req as any).user;
    if (!actor || actor.role !== 'admin') throw new UnauthorizedException('Admin only');
    return this.adminService.suspendTutor(id, reason);
  }

  @Post('tutors/:id/activate')
  async activateTutor(@Req() req: any, @Param('id') id: string) {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') throw new UnauthorizedException('Admin only');
    return this.adminService.activateTutor(id);
  }

  // Sync Clerk metadata endpoints
  @Get('clerk/sync-role-mismatches')
  async getRoleMismatches(@Req() req: any) {
    if (req.user.role !== 'admin') {
      throw new UnauthorizedException('Only admins can check role mismatches');
    }
    return this.syncClerkService.findRoleMismatches();
  }

  @Post('clerk/sync-user-role/:userId')
  async syncUserRole(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body('role') role: string,
  ) {
    if (req.user.role !== 'admin') {
      throw new UnauthorizedException('Only admins can sync user roles');
    }
    return this.syncClerkService.syncUserRoleToClerk(userId, role);
  }

  @Post('recordings/cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanupRecordings(@Req() req: any) {
    if (req.user.role !== 'admin') {
      throw new UnauthorizedException('Admin only');
    }
    return this.adminService.cleanupRecordings();
  }
}
