import { Controller, Post, Headers, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BackupService } from './backup.service';
import { ConfigService } from '@nestjs/config';

@Controller('admin/backup')
export class BackupController {
    private readonly logger = new Logger(BackupController.name);

    constructor(
        private readonly backupService: BackupService,
        private readonly configService: ConfigService
    ) {}

    @Post('trigger')
    async triggerBackup(@Headers('x-backup-key') keyHeader: string) {
        this.logger.log('🔐 Received manual backup trigger request...');
        
        const expectedKey = this.configService.get<string>('BACKUP_ENCRYPTION_KEY');
        if (!expectedKey) {
            this.logger.error('❌ BACKUP_ENCRYPTION_KEY is not defined in the environment.');
            throw new HttpException('Backup configuration error', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        if (keyHeader !== expectedKey) {
            this.logger.warn('⚠️ Unauthorized manual backup attempt with invalid key header.');
            throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
        }

        try {
            const blobName = await this.backupService.performDailyBackup();
            return {
                success: true,
                message: 'Manual backup triggered and uploaded successfully!',
                blobName,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error('❌ Manual backup trigger failed:', error);
            throw new HttpException(
                `Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}
