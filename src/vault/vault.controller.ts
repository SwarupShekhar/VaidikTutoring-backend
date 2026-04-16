import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VaultService } from './vault.service';

@Controller('vault')
export class VaultController {
  private readonly logger = new Logger(VaultController.name);

  constructor(private readonly vaultService: VaultService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAsset(
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Body('description') description: string,
    @Body('file_type') file_type: string,
    @Body('uploaded_by') uploaded_by?: string,
  ) {
    return this.vaultService.createAsset({
      title,
      description,
      file_type,
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      uploaded_by,
    });
  }

  @Get('assets')
  async findAll() {
    return this.vaultService.findAll();
  }

  @Get('assets/:id')
  async findOne(@Param('id') id: string) {
    return this.vaultService.findOne(id);
  }

  @Post('annotations')
  async saveAnnotations(
    @Body() data: {
      session_id: string;
      asset_id: string;
      student_id?: string;
      annotation_data: any;
      current_page: number;
    },
  ) {
    return this.vaultService.saveAnnotations(data);
  }

  @Get('annotations/:sessionId/:assetId')
  async getAnnotations(
    @Param('sessionId') sessionId: string,
    @Param('assetId') assetId: string,
    @Param('studentId') studentId?: string,
  ) {
    return this.vaultService.getAnnotations(sessionId, assetId, studentId);
  }
}
