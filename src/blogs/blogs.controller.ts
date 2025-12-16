import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    UseGuards,
    Req,
    Query,
    UnauthorizedException,
    NotFoundException,
} from '@nestjs/common';
import { BlogsService } from './blogs.service.js';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

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

    // Public: Get single blog by ID or Slug
    @Get('blogs/:idOrSlug')
    async findOne(@Param('idOrSlug') idOrSlug: string) {
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
