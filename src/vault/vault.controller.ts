import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { VaultService } from './vault.service';
import { SessionsService } from '../sessions/sessions.service';

@Controller('vault')
@UseGuards(ClerkAuthGuard)
export class VaultController {
  private readonly logger = new Logger(VaultController.name);

  constructor(
    private readonly vaultService: VaultService,
    private readonly sessionsService: SessionsService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAsset(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Body('description') description: string,
    @Body('file_type') file_type: string,
  ) {
    // Only staff may add to the shared library — otherwise any student/parent
    // could inject files. `uploaded_by` is taken from the token, never the body.
    const role = req.user?.role;
    if (role !== 'tutor' && role !== 'admin') {
      throw new ForbiddenException('Only tutors or admins can upload vault materials');
    }
    return this.vaultService.createAsset({
      title,
      description,
      file_type,
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      uploaded_by: req.user?.userId,
    });
  }

  // Role-aware: admins/tutors get the full library; students/parents only see
  // assets relevant to the student (curriculum + subjects they study).
  // Optional ?subject=<name> narrows to one subject (within the student's scope).
  // `studentId` lets a PARENT view a specific child's materials (parent-owns-child
  // is verified server-side). Ignored for students (they always see their own).
  @Get('assets')
  async findAll(
    @Req() req: any,
    @Query('subject') subject?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.vaultService.findAllForUser(req.user, subject, studentId);
  }

  // Returns a short-lived SAS URL. For students, membership is re-checked so an
  // asset id outside their scope cannot be opened by guessing it.
  @Get('assets/:id')
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Query('studentId') studentId?: string,
  ) {
    return this.vaultService.findOneForUser(id, req.user, studentId);
  }

  // View-only stream: pipes the asset bytes same-origin (no CORS) and never
  // exposes a SAS URL to the browser, so materials can't be pulled from the
  // Network tab. Same scope re-check as findOne for students.
  @Get('assets/:id/stream')
  async streamOne(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
    @Query('studentId') studentId?: string,
  ) {
    const result = await this.vaultService.streamAssetForUser(id, req.user, studentId);
    if (!result) throw new NotFoundException('Asset not found');

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Disposition', 'inline');
    if (result.contentLength) res.setHeader('Content-Length', String(result.contentLength));

    result.stream.on('error', (err) => {
      this.logger.error(`Vault stream error for asset ${id}: ${err?.message}`);
      if (!res.headersSent) res.status(500);
      res.end();
    });
    result.stream.pipe(res);
  }

  @Post('annotations')
  async saveAnnotations(
    @Req() req: any,
    @Body() data: {
      session_id: string;
      asset_id: string;
      student_id?: string;
      annotation_data: any;
      current_page: number;
    },
  ) {
    await this.sessionsService.verifySessionAccess(data.session_id, req.user?.userId);
    return this.vaultService.saveAnnotations(data);
  }

  @Get('annotations/:sessionId/:assetId')
  async getAnnotations(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Param('assetId') assetId: string,
    @Query('studentId') studentId?: string,
  ) {
    await this.sessionsService.verifySessionAccess(sessionId, req.user?.userId);
    return this.vaultService.getAnnotations(sessionId, assetId, studentId);
  }
}
