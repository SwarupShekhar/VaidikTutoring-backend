import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

interface BulkQuestionInput {
  curriculum_id: string;
  grade: string;
  questions: Array<{
    question_type: string;
    content: any;
    correct_answer?: any;
    metadata?: any;
  }>;
}

@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(
    private prisma: PrismaService,
    private studentsService: StudentsService
  ) {}

  /**
   * Bulk ingest questions from an Excel/JSON payload.
   * This is highly optimized using Prisma createMany to handle thousands of questions (e.g. SAT, PSLE).
   */
  async bulkIngestQuestions(payload: BulkQuestionInput) {
    try {
      const { curriculum_id, grade, questions } = payload;
      
      this.logger.log(`Starting bulk ingestion of ${questions.length} questions for Curriculum: ${curriculum_id}, Grade: ${grade}`);

      // Map the incoming payload to the Prisma schema
      const mappedQuestions = questions.map(q => ({
        curriculum_id,
        grade,
        question_type: q.question_type,
        content: q.content,
        correct_answer: q.correct_answer || null,
        metadata: q.metadata || {},
      }));

      // Execute bulk insert
      const result = await this.prisma.assessment_questions.createMany({
        data: mappedQuestions,
        skipDuplicates: true, // Prevents crashing if a question was already ingested
      });

      this.logger.log(`Successfully ingested ${result.count} questions.`);
      return { success: true, count: result.count };
      
    } catch (error: any) {
      this.logger.error('Failed to ingest questions: ' + (error.message || error));
      if (error.code) this.logger.error('Prisma Error Code: ' + error.code);
      throw new Error(`Bulk ingestion failed: ${error.message || error}`);
    }
  }

  /**
   * Fetch personalized questions for a specific student based on their profile tags.
   */
  async getPersonalizedQuestions(userId: string, limit: number = 20, curriculumIdOverride?: string, gradeOverride?: string) {
    let targetCurriculum = curriculumIdOverride;
    let targetGrade = gradeOverride;

    // 1. Get the student's curriculum and grade if overrides aren't fully provided
    if (!targetCurriculum || !targetGrade) {
      // Use StudentsService to fetch the student profile
      const student = await this.prisma.students.findUnique({
        where: { user_id: userId },
        select: { curriculum_preference: true, grade: true }
      });

      if (!student) {
        throw new NotFoundException('Student profile not found. Please complete onboarding or select a curriculum manually.');
      }

      if (!targetCurriculum) targetCurriculum = student.curriculum_preference || undefined;
      if (!targetGrade) targetGrade = student.grade || undefined;
    }

    if (!targetCurriculum || !targetGrade) {
      return [];
    }

    // 2. Fetch questions matching exactly the criteria using PostgreSQL RANDOM()
    const randomQuestions = await this.prisma.$queryRaw`
      SELECT * FROM app.assessment_questions
      WHERE curriculum_id = ${targetCurriculum}
        AND grade = ${targetGrade}
      ORDER BY RANDOM()
      LIMIT ${limit}
    `;

    return randomQuestions;
  }
}
