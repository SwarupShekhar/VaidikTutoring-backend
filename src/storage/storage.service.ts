import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

@Injectable()
export class StorageService {
    private readonly uploadDir = path.join(process.cwd(), 'public', 'uploads');

    constructor() {
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
    }

    async saveImage(file: Express.Multer.File): Promise<string> {
        // Use .webp extension as we are converting for better compression
        const baseName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9-_]/g, '-');
        const fileName = `${randomUUID()}-${baseName}.webp`;
        const filePath = path.join(this.uploadDir, fileName);

        // Image Optimization
        await sharp(file.buffer)
            .resize(1200, 800, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: 80 }) // Modern WebP format
            .toFile(filePath);

        // Return the relative URL
        return `/uploads/${fileName}`;
    }

    async deleteFile(fileUrl: string): Promise<void> {
        const fileName = path.basename(fileUrl);
        const filePath = path.join(this.uploadDir, fileName);
        
        try {
            await fsPromises.access(filePath);
            await fsPromises.unlink(filePath);
        } catch (err) {
            // File might not exist, which is fine for deletion
            if ((err as any).code !== 'ENOENT') {
                throw err;
            }
        }
    }
}
