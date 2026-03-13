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
} from '@nestjs/common';
import { BlogsService } from './blogs.service.js';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { UpdateBlogDto } from './dto/update-blog.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { BlogRedirectInterceptor } from './blog-redirect.interceptor.js';

@Controller()
export class BlogsController {
    constructor(private readonly blogsService: BlogsService) { }

    // Public: Get all PUBLISHED blogs
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

    // Public: Get single blog by ID or Slug (with 301 redirect for UUIDs)
    @UseInterceptors(BlogRedirectInterceptor)
    @Get('blogs/:idOrSlug')
    async findOne(@Param('idOrSlug') idOrSlug: string) {
        // Check if input is a UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

        if (isUuid) {
            // For UUID requests, fetch the blog to get its slug and redirect
            const blog = await this.blogsService.findOneById(idOrSlug);
            if (!blog || !blog.slug) {
                throw new NotFoundException('Blog not found');
            }
            // Return redirect info for frontend to handle or middleware to process
            return {
                _redirect: true,
                status: 301,
                slug: blog.slug,
                url: `/blogs/${blog.slug}`
            };
        }

        // For slug requests, return the blog directly
        const blog = await this.blogsService.findOne(idOrSlug);
        if (!blog) {
            throw new NotFoundException('Blog not found');
        }
        return blog;
    }

    // Protected: Get single blog for editing
    @UseGuards(JwtAuthGuard)
    @Get('admin/blogs/:id')
    async findOneForAdmin(@Param('id') id: string) {
        const blog = await this.blogsService.findOneById(id);
        if (!blog) {
            throw new NotFoundException('Blog not found');
        }
        return blog;
    }

    // Protected: Create new blog
    @UseGuards(JwtAuthGuard)
    @Post('admin/blogs')
    async create(@Req() req: any, @Body() createBlogDto: CreateBlogDto) {
        const user = req.user;
        if (!user) {
            throw new UnauthorizedException();
        }
        return this.blogsService.create(createBlogDto, user);
    }

    // Protected: Get ALL blogs (Admin Dashboard)
    @UseGuards(JwtAuthGuard)
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
        return this.blogsService.findAll(pageNum, limitNum);
    }
    
    // Protected: Update blog (Admin/Tutor)
    @UseGuards(JwtAuthGuard)
    @Patch('admin/blogs/:id')
    async update(
        @Req() req: any,
        @Param('id') id: string,
        @Body() updateBlogDto: UpdateBlogDto
    ) {
        const user = req.user;
        const blog = await this.blogsService.findOneById(id);
        
        if (!blog) {
            throw new NotFoundException('Blog not found');
        }

        // Tutors can only update their own blogs
        if (user.role === 'tutor' && blog.author_id !== user.userId) {
            throw new UnauthorizedException('You can only edit your own blogs');
        }

        return this.blogsService.update(id, updateBlogDto, user);
    }

    // Protected: Get version history (Admin/Tutor)
    @UseGuards(JwtAuthGuard)
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
    @UseGuards(JwtAuthGuard)
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
    @UseGuards(JwtAuthGuard)
    @Patch('admin/blogs/:id/status')
    async updateStatus(
        @Req() req: any,
        @Param('id') id: string,
        @Body('status') status: string,
    ) {
        if (req.user.role !== 'admin') {
            throw new UnauthorizedException('Only admins can update blog status');
        }
        return this.blogsService.updateStatus(id, status);
    }

    // Protected: Delete Blog (Admin Only)
    @UseGuards(JwtAuthGuard)
    @Delete('admin/blogs/:id')
    async remove(@Req() req: any, @Param('id') id: string) {
        if (req.user.role !== 'admin') {
            throw new UnauthorizedException('Only admins can delete blogs');
        }
        return this.blogsService.remove(id);
    }

    // Emergency: Check blog data status (Admin Only)
    @UseGuards(JwtAuthGuard)
    @Get('admin/blogs/emergency-check')
    async emergencyCheck(@Req() req: any) {
        if (req.user.role !== 'admin') {
            throw new UnauthorizedException('Only admins can check blog status');
        }
        return this.blogsService.emergencyCheck();
    }
}
