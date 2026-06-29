import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AzureStorageService } from '../azure/azure-storage.service';

type AuthUser = { userId?: string; role?: string } | undefined;

/** The slice of a student needed to decide which vault assets are relevant. */
interface StudentScope {
  studentId: string;
  curriculumId: string | null;
  subjectIds: string[];
}

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    private prisma: PrismaService,
    private azureStorage: AzureStorageService,
  ) {}

  async createAsset(data: {
    title: string;
    description?: string;
    file_type: string;
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    uploaded_by?: string;
  }) {
    const blobName = await this.azureStorage.uploadVaultAsset(
      data.buffer,
      data.mimeType,
      data.originalName,
    );

    return this.prisma.vault_assets.create({
      data: {
        title: data.title,
        description: data.description,
        file_type: data.file_type,
        azure_blob_name: blobName,
        mime_type: data.mimeType,
        uploaded_by: data.uploaded_by,
      },
    });
  }

  async findAll() {
    return this.prisma.vault_assets.findMany({
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string) {
    const asset = await this.prisma.vault_assets.findUnique({
      where: { id },
    });

    if (asset) {
      const sasUrl = await this.azureStorage.generateShortLivedSas(asset.azure_blob_name);
      return { ...asset, sasUrl };
    }
    return null;
  }

  // ---- Authorization-aware access (used by the guarded controller) ----

  private isPrivileged(user: AuthUser): boolean {
    return user?.role === 'admin' || user?.role === 'tutor';
  }

  /** Resolve the requesting student's curriculum + the subjects they actually study. */
  private async getStudentScope(userId?: string): Promise<StudentScope | null> {
    if (!userId) return null;
    const student = await this.prisma.students.findFirst({
      where: { user_id: userId },
      select: { id: true, curriculum_preference: true },
    });
    if (!student) return null;

    // Subjects a student studies = the distinct subjects across their bookings.
    const bookings = await this.prisma.bookings.findMany({
      where: { student_id: student.id, subject_id: { not: null } },
      select: { subject_id: true },
      distinct: ['subject_id'],
    });
    const subjectIds = bookings
      .map((b) => b.subject_id)
      .filter((s): s is string => !!s);

    return {
      studentId: student.id,
      curriculumId: student.curriculum_preference ?? null,
      subjectIds,
    };
  }

  /**
   * A vault asset is relevant to a student when its curriculum matches (or it is
   * curriculum-agnostic) AND its subject is one the student studies (or it is
   * subject-agnostic). As a safety net, anything explicitly shared with the
   * student in a live session is always viewable, so in-session viewing never
   * breaks even if the asset isn't tagged to their curriculum/subject.
   */
  private async assetVisibleToStudent(
    asset: { id: string; curriculum_id: string | null; subject_id: string | null },
    scope: StudentScope,
  ): Promise<boolean> {
    const curriculumOk = !asset.curriculum_id || asset.curriculum_id === scope.curriculumId;
    const subjectOk = !asset.subject_id || scope.subjectIds.includes(asset.subject_id);
    if (curriculumOk && subjectOk) return true;

    const shared = await this.prisma.session_asset_annotations.findFirst({
      where: { asset_id: asset.id, student_id: scope.studentId },
      select: { id: true },
    });
    return !!shared;
  }

  /** Resolve a subject NAME (as shown on the dashboard) to its id. */
  private async resolveSubjectId(name: string): Promise<string | null> {
    const subj = await this.prisma.subjects.findFirst({
      where: { name },
      select: { id: true },
    });
    return subj?.id ?? null;
  }

  /**
   * Role-aware list: full library for staff, curriculum+subject scoped for
   * students. Optional `subjectName` narrows to a single subject (deep-link
   * from the dashboard "Your subjects" pills) — still inside the student's scope.
   */
  async findAllForUser(user: AuthUser, subjectName?: string) {
    let subjectId: string | null = null;
    if (subjectName) {
      subjectId = await this.resolveSubjectId(subjectName);
      if (!subjectId) return []; // asked for a subject that doesn't exist
    }

    if (this.isPrivileged(user)) {
      return this.prisma.vault_assets.findMany({
        where: subjectId ? { subject_id: subjectId } : {},
        orderBy: { created_at: 'desc' },
      });
    }

    const scope = await this.getStudentScope(user?.userId);
    if (!scope) return [];

    const curriculumOr = scope.curriculumId
      ? [{ curriculum_id: null }, { curriculum_id: scope.curriculumId }]
      : [{ curriculum_id: null }];
    const subjectOr = scope.subjectIds.length
      ? [{ subject_id: null }, { subject_id: { in: scope.subjectIds } }]
      : [{ subject_id: null }];

    const AND: any[] = [{ OR: curriculumOr }, { OR: subjectOr }];
    if (subjectId) AND.push({ subject_id: subjectId });

    return this.prisma.vault_assets.findMany({
      where: { AND },
      orderBy: { created_at: 'desc' },
    });
  }

  /** Role-aware single asset + SAS URL, with a membership re-check for students. */
  async findOneForUser(id: string, user: AuthUser) {
    const asset = await this.prisma.vault_assets.findUnique({ where: { id } });
    if (!asset) return null;

    if (!this.isPrivileged(user)) {
      const scope = await this.getStudentScope(user?.userId);
      const allowed = scope ? await this.assetVisibleToStudent(asset, scope) : false;
      if (!allowed) {
        throw new ForbiddenException('You do not have access to this material.');
      }
    }

    const sasUrl = await this.azureStorage.generateShortLivedSas(asset.azure_blob_name);
    return { ...asset, sasUrl };
  }

  /**
   * Same role/scope authorization as findOneForUser, but returns the blob bytes
   * (stream) instead of a SAS URL — so the controller can pipe them to the
   * browser same-origin. The SAS never leaves the server.
   */
  async streamAssetForUser(id: string, user: AuthUser) {
    const asset = await this.prisma.vault_assets.findUnique({ where: { id } });
    if (!asset) return null;

    if (!this.isPrivileged(user)) {
      const scope = await this.getStudentScope(user?.userId);
      const allowed = scope ? await this.assetVisibleToStudent(asset, scope) : false;
      if (!allowed) {
        throw new ForbiddenException('You do not have access to this material.');
      }
    }

    const blob = await this.azureStorage.downloadVaultAsset(asset.azure_blob_name);
    return {
      stream: blob.stream,
      contentType: blob.contentType || asset.mime_type || 'application/octet-stream',
      contentLength: blob.contentLength,
    };
  }

  async saveAnnotations(data: {
    session_id: string;
    asset_id: string;
    student_id?: string;
    annotation_data: any;
    current_page: number;
  }) {
    return this.prisma.session_asset_annotations.upsert({
      where: {
        // Since we don't have a composite unique constraint yet, we'll find or create
        // In a real app, you might want to add @@unique([session_id, asset_id, student_id])
        id: (await this.prisma.session_asset_annotations.findFirst({
          where: {
            session_id: data.session_id,
            asset_id: data.asset_id,
            student_id: data.student_id,
          }
        }))?.id || '00000000-0000-0000-0000-000000000000', // Dummy UUID for upsert to fail and use create
      },
      update: {
        annotation_data: data.annotation_data,
        current_page: data.current_page,
      },
      create: {
        session_id: data.session_id,
        asset_id: data.asset_id,
        student_id: data.student_id,
        annotation_data: data.annotation_data,
        current_page: data.current_page,
      },
    });
  }

  async getAnnotations(sessionId: string, assetId: string, studentId?: string) {
    return this.prisma.session_asset_annotations.findFirst({
      where: {
        session_id: sessionId,
        asset_id: assetId,
        student_id: studentId,
      },
    });
  }
}
