import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AzureStorageService } from '../azure/azure-storage.service';

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
