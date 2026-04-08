import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { BlobServiceClient, BlobSASPermissions } from '@azure/storage-blob';
import axios from 'axios';

@Injectable()
export class AzureStorageService implements OnModuleInit {
  private blobServiceClient: BlobServiceClient;
  private logger = new Logger(AzureStorageService.name);
  
  // Containers
  private readonly RECORDINGS_CONTAINER = 'session-recordings';
  private readonly SNAPSHOTS_CONTAINER = 'whiteboard-snapshots';
  private readonly SLIDES_CONTAINER = 'session-slides';

  constructor() {
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
    const containers = [this.RECORDINGS_CONTAINER, this.SNAPSHOTS_CONTAINER, this.SLIDES_CONTAINER];
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
   * Pipes a video from a URL (Daily.co) directly to Azure.
   * This is memory efficient and handles large video files easily.
   */
  async uploadFromUrl(sessionId: string, url: string): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(this.RECORDINGS_CONTAINER);
    const blobName = `${sessionId}/${Date.now()}.mp4`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const headers: Record<string, string> = {};
    if (url.includes('daily.co')) {
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

  async generateSasUrl(containerName: 'session-recordings' | 'whiteboard-snapshots' | 'session-slides', blobName: string, expiryHours = 24): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const expiresOn = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    
    const sasUrl = await blockBlobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn
    });
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
}
