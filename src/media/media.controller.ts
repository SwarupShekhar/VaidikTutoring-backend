import {
    Controller,
    Post,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    ParseFilePipe,
    MaxFileSizeValidator,
    FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { StorageService } from '../storage/storage.service';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

@Controller('admin/media')
export class MediaController {
    constructor(private readonly storageService: StorageService) { }

    @UseGuards(ClerkAuthGuard)
    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadFile(
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE }),
                    new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp|gif)$/ }),
                ],
            }),
        )
        file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        const url = await this.storageService.saveImage(file);
        return { url };
    }
}
