import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    HttpCode,
    HttpStatus,
    Delete,
    Put,
    UseGuards,
    UseInterceptors,
    Req,
    Query,
    UnauthorizedException,
    NotFoundException,
    Redirect,
    Headers,
} from '@nestjs/common';
import { BlogsService } from './blogs.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { BlogRedirectInterceptor } from './blog-redirect.interceptor';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';

@Controller()
export class BlogsController {
    constructor(private readonly blogsService: BlogsService) { }

    // Public: Get all PUBLISHED blogs
    @UseInterceptors(CacheInterceptor)
    @CacheTTL(60 * 5) // 5 minutes
    @Get('blogs')
    async findAllPublished(
        @Query('page') page?: string,
        @Query('category') category?: string,
        @Query('limit') limit?: string,
    ) {
        const pageNum = parseInt(page || '1', 10);
        const limitNum = parseInt(limit || '10', 10);
        return this.blogsService.findAllPublished(pageNum, limitNum, category); // Return only published
    }

    // Protected: Get list of internal links for the editor
    @UseGuards(ClerkAuthGuard)
    @Get('admin/blogs/internal-links')
    async getInternalLinks() {
        return this.blogsService.getInternalLinks();
    }

    // Public: Get single blog by ID or Slug (with 301 redirect for UUIDs)
    @UseInterceptors(CacheInterceptor, BlogRedirectInterceptor)
    @CacheTTL(60 * 10) // 10 minutes
    @Get('blogs/:idOrSlug')
    async findOne(
        @Param('idOrSlug') idOrSlug: string,
        @Headers('x-preview-secret') previewSecret?: string
    ) {
        // Check if input is a UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

        if (isUuid) {
            // For UUID requests, fetch the blog to get its slug and redirect.
            // findOneById throws UnauthorizedException for unpublished — convert to 404
            // so we don't leak whether a draft exists.
            let blog: any;
            try {
                blog = await this.blogsService.findOneById(idOrSlug, previewSecret);
            } catch {
                throw new NotFoundException('Blog not found');
            }
            if (!blog || !blog.slug) {
                throw new NotFoundException('Blog not found');
            }
            return {
                _redirect: true,
                status: 301,
                slug: blog.slug,
                url: `/blogs/${blog.slug}`
            };
        }

        // For slug requests, return the blog directly
        let blog: any;
        try {
            blog = await this.blogsService.findOne(idOrSlug, previewSecret);
        } catch {
            throw new NotFoundException('Blog not found');
        }
        if (!blog) {
            throw new NotFoundException('Blog not found');
        }
        return blog;
    }

    // Emergency: Check blog data status (Admin Only)
    @UseGuards(ClerkAuthGuard)
    @Get('admin/blogs/emergency-check')
    async emergencyCheck(@Req() req: any) {
        if (req.user.role !== 'admin') {
            throw new UnauthorizedException('Only admins can check blog status');
        }
        return this.blogsService.emergencyCheck();
    }

    // Protected: Get single blog for editing
    @UseGuards(ClerkAuthGuard)
    @Get('admin/blogs/:id')
    async findOneForAdmin(@Param('id') id: string, @Req() req: any) {
        const blog = await this.blogsService.findOneById(id, undefined, req.user);
        if (!blog) {
            throw new NotFoundException('Blog not found');
        }
        return blog;
    }

    // Protected: Create new blog
    @UseGuards(ClerkAuthGuard)
    @Post('admin/blogs')
    async create(@Req() req: any, @Body() createBlogDto: CreateBlogDto) {
        const user = req.user;
        if (!user) {
            throw new UnauthorizedException();
        }
        return this.blogsService.create(createBlogDto, user);
    }

    // Protected: Get ALL blogs (Admin Dashboard)
    @UseGuards(ClerkAuthGuard)
    @Get('admin/blogs')
    async findAll(
        @Req() req: any,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const user = req.user;
        if (user.role !== 'admin' && user.role !== 'tutor') {
            throw new UnauthorizedException('Only admins and tutors can view all blogs');
        }
        const pageNum = parseInt(page || '1', 10);
        const limitNum = parseInt(limit || '10', 10);
        return this.blogsService.findAll(pageNum, limitNum, user);
    }
    
    // Protected: Update blog (Admin/Tutor)
    @UseGuards(ClerkAuthGuard)
    @Patch('admin/blogs/:id')
    async update(
        @Req() req: any,
        @Param('id') id: string,
        @Body() updateBlogDto: UpdateBlogDto
    ) {
        const user = req.user;
        // Pass user so findOneById allows tutors to access their own PENDING/REJECTED drafts
        const blog = await this.blogsService.findOneById(id, undefined, user);
        
        if (!blog) {
            throw new NotFoundException('Blog not found');
        }

        // Tutors can only update their own blogs
        if (user.role === 'tutor' && blog.author_id !== user.userId) {
            throw new UnauthorizedException('You can only edit your own blogs');
        }
        if (user.role !== 'admin' && user.role !== 'tutor') {
            throw new UnauthorizedException('Only admins and tutors can edit blogs');
        }

        return this.blogsService.update(id, updateBlogDto, user);
    }

    // Protected: Get version history (Admin/Tutor)
    @UseGuards(ClerkAuthGuard)
    @Get('admin/blogs/:id/versions')
    async getVersions(@Req() req: any, @Param('id') id: string) {
        const user = req.user;
        const blog = await this.blogsService.findOneById(id);
        if (!blog) throw new NotFoundException('Blog not found');

        if (user.role === 'tutor' && blog.author_id !== user.userId) {
            throw new UnauthorizedException('You can only view versions of your own blogs');
        }

        return this.blogsService.getVersions(id);
    }

    // Protected: Restore version (Admin/Tutor)
    @UseGuards(ClerkAuthGuard)
    @Post('admin/blogs/:id/versions/:versionId/restore')
    async restoreVersion(
        @Req() req: any,
        @Param('id') id: string,
        @Param('versionId') versionId: string
    ) {
        const user = req.user;
        const blog = await this.blogsService.findOneById(id);
        if (!blog) throw new NotFoundException('Blog not found');

        if (user.role === 'tutor' && blog.author_id !== user.userId) {
            throw new UnauthorizedException('You can only restore versions of your own blogs');
        }

        return this.blogsService.restoreVersion(id, versionId, user);
    }

    // Protected: Approve/Reject (Admin Only)
    @UseGuards(ClerkAuthGuard)
    @Patch('admin/blogs/:id/status')
    async updateStatus(
        @Req() req: any,
        @Param('id') id: string,
        @Body('status') status: string,
        @Body('reason') reason?: string,
    ) {
        if (req.user.role !== 'admin') {
            throw new UnauthorizedException('Only admins can update blog status');
        }
        return this.blogsService.updateStatus(id, status, reason, req.user);
    }

    // Protected: Delete Blog (Admin Only)
    @UseGuards(ClerkAuthGuard)
    @Delete('admin/blogs/:id')
    async remove(@Req() req: any, @Param('id') id: string) {
        if (req.user.role !== 'admin') {
            throw new UnauthorizedException('Only admins can delete blogs');
        }
        return this.blogsService.remove(id);
    }
}
