import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { BlobServiceClient, BlobSASPermissions } from '@azure/storage-blob';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';

@Injectable()
export class AzureStorageService implements OnModuleInit {
  private blobServiceClient: BlobServiceClient;
  private logger = new Logger(AzureStorageService.name);
  
  // Containers
  private readonly RECORDINGS_CONTAINER = 'session-recordings';
  private readonly SNAPSHOTS_CONTAINER = 'whiteboard-snapshots';
  private readonly SLIDES_CONTAINER = 'session-slides';
  private readonly NOTES_CONTAINER = 'class-notes';
  private readonly VAULT_CONTAINER = 'vault-assets';


  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      this.logger.error('AZURE_STORAGE_CONNECTION_STRING is missing in environment variables');
    } else {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    }
  }

  async onModuleInit() {
    if (this.blobServiceClient) {
      await this.ensureContainers();
    }
  }

  private async ensureContainers() {
    const containers = [
      this.RECORDINGS_CONTAINER, 
      this.SNAPSHOTS_CONTAINER, 
      this.SLIDES_CONTAINER, 
      this.NOTES_CONTAINER,
      this.VAULT_CONTAINER
    ];

    for (const container of containers) {
      const containerClient = this.blobServiceClient.getContainerClient(container);
      const exists = await containerClient.exists();
      if (!exists) {
        await containerClient.create({ access: undefined });
        this.logger.log(`Created container: ${container}`);
      }
    }
  }

  async uploadRecording(sessionId: string, buffer: Buffer, mimeType: string): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.RECORDINGS_CONTAINER);
    const blobName = `${sessionId}/${Date.now()}.mp4`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType }
    });
    return blobName;
  }

  /**
   * Pipes a video from a URL (Daily.co or Zoom) directly to Azure.
   * This is memory efficient and handles large video files easily.
   */
  async uploadFromUrl(sessionId: string, url: string, customHeaders?: Record<string, string>): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.RECORDINGS_CONTAINER);
    const blobName = `${sessionId}/${Date.now()}.mp4`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const headers: Record<string, string> = { ...customHeaders };
    if (url.includes('daily.co') && !headers['Authorization']) {
        const dailyKey = process.env.DAILY_API_KEY;
        if (dailyKey) {
            headers['Authorization'] = `Bearer ${dailyKey}`;
        }
    }

    // Use axios to get a stream of the file
    const response = await axios.get(url, { 
        responseType: 'stream',
        headers
    });
    
    // Upload the stream to Azure
    await blockBlobClient.uploadStream(response.data, undefined, undefined, {
      blobHTTPHeaders: { blobContentType: 'video/mp4' }
    });

    return blobName;
  }

  async uploadWhiteboardSnapshot(sessionId: string, buffer: Buffer): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.SNAPSHOTS_CONTAINER);
    const blobName = `${sessionId}/${Date.now()}.png`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: 'image/png' }
    });
    return blobName;
  }

  async uploadSlide(sessionId: string, buffer: Buffer, mimeType: string, originalName: string): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.SLIDES_CONTAINER);
    const blobName = `${sessionId}/${Date.now()}-${originalName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType }
    });
    return blobName;
  }

  async uploadNote(sessionId: string, buffer: Buffer, mimeType: string, originalName: string): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.NOTES_CONTAINER);
    const blobName = `${sessionId}/${Date.now()}-${originalName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType }
    });
    return blobName;
  }

  async generateSasUrl(containerName: 'session-recordings' | 'whiteboard-snapshots' | 'session-slides' | 'class-notes', blobName: string, expiryHours = 24): Promise<string> {
    const cacheKey = `sas:${containerName}:${blobName}`;
    const cachedUrl = await this.cacheManager.get<string>(cacheKey);
    if (cachedUrl) return cachedUrl;

    const containerClient = this.blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const expiresOn = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    
    const sasUrl = await blockBlobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn
    });

    const ttlMs = (expiryHours * 60 * 60 * 1000) - (5 * 60 * 1000);
    await this.cacheManager.set(cacheKey, sasUrl, Math.max(ttlMs, 60000));

    return sasUrl;
  }

  async deleteBlob(containerName: string, blobName: string): Promise<void> {
    const containerClient = this.blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.deleteIfExists();
  }

  /**
   * Ready for a cron job to call listUnviewedOlderThan(30)
   */
  async listUnviewedOlderThan(days: number): Promise<string[]> {
    const containerClient = this.blobServiceClient.getContainerClient(this.RECORDINGS_CONTAINER);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const blobs: string[] = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      if (blob.properties.createdOn && blob.properties.createdOn < cutoff) {
        blobs.push(blob.name);
      }
    }
    return blobs;
  }

  async uploadVaultAsset(buffer: Buffer, mimeType: string, originalName: string): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.VAULT_CONTAINER);
    const blobName = `admin/${Date.now()}-${originalName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType }
    });
    return blobName;
  }

  /**
   * Server-side download of a vault blob. Lets the API stream bytes to the
   * browser same-origin (no CORS) without ever handing a SAS URL to the client —
   * keeps view-only materials un-downloadable from the Network tab.
   */
  async downloadVaultAsset(blobName: string): Promise<{
    stream: NodeJS.ReadableStream;
    contentType?: string;
    contentLength?: number;
  }> {
    const containerClient = this.blobServiceClient.getContainerClient(this.VAULT_CONTAINER);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const download = await blockBlobClient.download();
    return {
      stream: download.readableStreamBody as NodeJS.ReadableStream,
      contentType: download.contentType,
      contentLength: download.contentLength,
    };
  }

  async generateShortLivedSas(blobName: string): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.VAULT_CONTAINER);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const expiresOn = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    const sasUrl = await blockBlobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn
    });
    return sasUrl;
  }

  async uploadSubmissionAsset(studentId: string, buffer: Buffer, mimeType: string, originalName: string): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.VAULT_CONTAINER);
    const blobName = `submissions/${studentId}/${Date.now()}-${originalName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType }
    });
    return blobName;
  }
}

