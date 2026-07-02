import { Controller, Post, Body, UseInterceptors, UploadedFile, HttpException, HttpStatus, Logger, Get, Query, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssessmentsService } from './assessments.service';
import * as xlsx from 'xlsx';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorators';

@Controller('assessments')
@UseGuards(ClerkAuthGuard, RolesGuard)
export class AssessmentsController {
  private readonly logger = new Logger(AssessmentsController.name);

  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Post('bulk-upload')
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUploadQuestions(
    @UploadedFile() file: Express.Multer.File,
    @Body('curriculum_id') curriculum_id: string,
    @Body('grade') grade: string
  ) {
    if (!file) {
      throw new HttpException('File is required', HttpStatus.BAD_REQUEST);
    }
    if (!curriculum_id || !grade) {
      throw new HttpException('curriculum_id and grade are required', HttpStatus.BAD_REQUEST);
    }

    try {
      this.logger.log(`Parsing uploaded file: ${file.originalname}`);
      const workbook = xlsx.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json<any>(sheet);

      if (rows.length === 0) {
        throw new HttpException('Excel file is empty', HttpStatus.BAD_REQUEST);
      }

      // Convert rows into expected format
      const questions = rows.map((row: any) => ({
        question_type: row.question_type || 'MCQ',
        content: {
          question_text: row.question_text || '',
          options: [row.option_a, row.option_b, row.option_c, row.option_d].filter(Boolean),
          passage: row.passage || null,
          explanation: row.explanation || null,
        },
        correct_answer: row.correct_answer || null,
        metadata: {
          difficulty: row.difficulty || 'medium',
          topic: row.topic || ''
        }
      }));

      // Ingest
      const result = await this.assessmentsService.bulkIngestQuestions({
        curriculum_id,
        grade,
        questions
      });

      return {
        message: 'Successfully ingested questions',
        count: result.count
      };

    } catch (error) {
      this.logger.error('Bulk upload failed', error);
      throw new HttpException('Failed to parse and upload questions: ' + error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('personalized')
  async getPersonalizedQuestions(
    @Query('user_id') user_id: string,
    @Query('limit') limit?: number,
    @Query('curriculum_id') curriculum_id?: string,
    @Query('grade') grade?: string
  ) {
    if (!user_id) {
      throw new HttpException('user_id is required', HttpStatus.BAD_REQUEST);
    }
    const parsedLimit = limit ? parseInt(limit.toString(), 10) : 20;
    return this.assessmentsService.getPersonalizedQuestions(user_id, parsedLimit, curriculum_id, grade);
  }
}
