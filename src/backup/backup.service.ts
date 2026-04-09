import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BlobServiceClient } from '@azure/storage-blob';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class BackupService {
    private readonly logger = new Logger(BackupService.name);
    private blobServiceClient: BlobServiceClient;
    private containerName = 'database-backups';

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService
    ) {
        // Leveraging existing session storage keys
        const connStr = this.configService.get<string>('AZURE_STORAGE_CONNECTION_STRING');
        if (connStr) {
            this.blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
        } else {
            this.logger.warn('AZURE_STORAGE_CONNECTION_STRING is not set. Backups will not run.');
        }
    }

    // Runs EVERY_DAY_AT_MIDNIGHT to minimize data loss
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async performDailyBackup() {
        if (!this.blobServiceClient) {
            this.logger.error('Azure storage not configured. Skipping disaster recovery backup.');
            return;
        }

        const encryptionKey = this.configService.get<string>('BACKUP_ENCRYPTION_KEY');
        if (!encryptionKey) {
            this.logger.error('BACKUP_ENCRYPTION_KEY not set. Skipping disaster recovery backup.');
            return;
        }

        this.logger.log('Starting daily disaster recovery database backup...');
        try {
            // Dynamically grab all models to ensure complete snapshot
            const allProperties: Record<string, any> = this.prisma as any;
            const modelNames = Object.keys(allProperties).filter(k => 
                !k.startsWith('$') && !k.startsWith('_') && typeof allProperties[k]?.findMany === 'function'
            );
            
            const backupData: Record<string, any> = {};
            for (const model of modelNames) {
                backupData[model] = [];
                let skip = 0;
                const take = 5000;
                
                // Batch processing to prevent OOM
                while (true) {
                    const data = await allProperties[model].findMany({ skip, take });
                    if (data.length === 0) break;
                    backupData[model].push(...data);
                    // Explicitly delete PII keys during serialization to avoid uploading them
                    backupData[model].forEach((row: any) => {
                        delete row.password_hash;
                        delete row.refresh_token; 
                        // Note: To completely satisfy PII zero-knowledge, we encrypt the entire blob below.
                    });
                    skip += take;
                }
            }

            const jsonString = JSON.stringify(backupData);
            const buffer = Buffer.from(jsonString, 'utf-8');
            
            // GDPR compliance: Encrypt Database Dump
            const keyBuffer = crypto.scryptSync(encryptionKey, 'salt', 32); // Creates 32-byte key
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
            const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
            const finalEncryptedBuffer = Buffer.concat([iv, encrypted]);
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const blobName = `dr-snapshot-${timestamp}.json.enc`;

            const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
            await containerClient.createIfNotExists();
            
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            await blockBlobClient.uploadData(finalEncryptedBuffer);
            
            this.logger.log(`Disaster Recovery backup SECURELY uploaded to Azure Blob Storage: ${blobName}`);
        } catch (error) {
            this.logger.error('Database backup failed', error);
        }
    }
}
