import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    UseGuards,
    UseInterceptors,
    Req,
    Query,
    UnauthorizedException,
    NotFoundException,
    Redirect,
    BadRequestException,
} from '@nestjs/common';
import { BlogsService } from './blogs.service.js';
import { CreateBlogDto } from './dto/create-blog.dto.js';
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
    async findAll(@Req() req: any) {
        const user = req.user;
        if (user.role !== 'admin' && user.role !== 'tutor') {
            throw new UnauthorizedException('Only admins and tutors can view all blogs');
        }
        return this.blogsService.findAll();
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
}
