import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AzureStorageService } from '../azure/azure-storage.service';
import { StudentsService } from '../students/students.service';

@Injectable()
export class AssignmentsService {
  constructor(
    private prisma: PrismaService,
    private azureStorage: AzureStorageService,
    private studentsService: StudentsService
  ) {}

  async createAssignment(data: any, tutorId: string) {
    return this.prisma.assignments.create({
      data: {
        title: data.title,
        description: data.description,
        curriculum_id: data.curriculum_id,
        grade: data.grade,
        asset_id: data.asset_id,
        due_date: data.due_date ? new Date(data.due_date) : null,
        created_by: tutorId,
      },
    });
  }

  async getAssignments(curriculumId?: string, grade?: string, userId?: string) {
    const where: any = {};
    let resolvedStudentId: string | undefined;
    
    // If userId is provided, auto-filter by their curriculum and grade
    if (userId && (!curriculumId || !grade)) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: userId }
      });
      if (student) {
        resolvedStudentId = student.id;
        if (!curriculumId && student.curriculum_preference) where.curriculum_id = student.curriculum_preference;
        if (!grade && student.grade) where.grade = student.grade;
      }
    } else if (userId) {
      // Just resolve the student ID for filtering submissions
      try {
        resolvedStudentId = await this.studentsService.getStudentIdByUserId(userId);
      } catch (e) {
        // Not a student user
      }
    }

    if (curriculumId) where.curriculum_id = curriculumId;
    if (grade) where.grade = grade;
    
    const assignments = await this.prisma.assignments.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        vault_assets: true,
        submissions: resolvedStudentId ? {
          where: { student_id: resolvedStudentId }
        } : true
      }
    });

    const assignmentsWithSas = await Promise.all(assignments.map(async (a) => {
      let sasUrl: string | null = null;
      if (a.vault_assets?.azure_blob_name) {
         sasUrl = await this.azureStorage.generateShortLivedSas(a.vault_assets.azure_blob_name);
      }
      
      let submissionSasUrls = await Promise.all((a.submissions || []).map(async (sub) => {
        if (sub.azure_blob_name) {
          const subSasUrl = await this.azureStorage.generateShortLivedSas(sub.azure_blob_name);
          return { ...sub, sasUrl: subSasUrl };
        }
        return sub;
      }));

      return {
         ...a,
         vault_assets: a.vault_assets ? { ...a.vault_assets, sasUrl } : null,
         submissions: submissionSasUrls
      };
    }));

    return assignmentsWithSas;
  }

  async submitAssignmentWithFile(assignmentId: string, userId: string, file: Express.Multer.File) {
    const resolvedStudentId = await this.studentsService.getStudentIdByUserId(userId);
    
    const azureBlobName = await this.azureStorage.uploadSubmissionAsset(
      resolvedStudentId,
      file.buffer,
      file.mimetype,
      file.originalname
    );

    return this.submitAssignment(assignmentId, resolvedStudentId, azureBlobName);
  }

  async submitAssignment(assignmentId: string, studentId: string, azureBlobName: string) {
    // Check if submission already exists
    const existing = await this.prisma.submissions.findFirst({
      where: { assignment_id: assignmentId, student_id: studentId }
    });

    if (existing) {
      return this.prisma.submissions.update({
        where: { id: existing.id },
        data: {
          azure_blob_name: azureBlobName,
          submitted_at: new Date(),
        }
      });
    }

    return this.prisma.submissions.create({
      data: {
        assignment_id: assignmentId,
        student_id: studentId,
        azure_blob_name: azureBlobName,
        submitted_at: new Date(),
      }
    });
  }

  async gradeAssignment(submissionId: string, score: number, feedback: string) {
    const existing = await this.prisma.submissions.findUnique({
      where: { id: submissionId }
    });

    if (!existing) {
      throw new NotFoundException('Submission not found');
    }

    return this.prisma.submissions.update({
      where: { id: submissionId },
      data: {
        score,
        feedback,
        graded_at: new Date(),
      }
    });
  }
}
