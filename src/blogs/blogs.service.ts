import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BlogsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(createBlogDto: CreateBlogDto, user: any) {
        // Admin gets PUBLISHED immediately, Tutor gets PENDING
        const initialStatus = user.role === 'admin' ? 'PUBLISHED' : 'PENDING';

        // Generate Slug from Title
        let slug = createBlogDto.title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');

        // Ensure uniqueness
        const existing = await this.prisma.blogs.findUnique({ where: { slug } });
        if (existing) {
            slug = `${slug}-${Date.now()}`;
        }

        return this.prisma.blogs.create({
            data: {
                title: createBlogDto.title,
                excerpt: createBlogDto.excerpt,
                content: createBlogDto.content,
                image_url: createBlogDto.imageUrl,
                category: createBlogDto.category,
                slug,
                status: initialStatus,
                author_id: user.sub || user.userId,
            },
        });
    }

    async findAllPublished(page: number, limit: number, category?: string) {
        const skip = (page - 1) * limit;
        const whereClause: any = { status: 'PUBLISHED' };

        if (category) {
            whereClause.category = category;
        }

        // Debug logging
        console.log('[Blogs Service] Fetching blogs with where:', whereClause);
        console.log('[Blogs Service] Skip:', skip, 'Limit:', limit);

        const [data, total] = await Promise.all([
            this.prisma.blogs.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: { created_at: 'desc' },
                include: {
                    users: {
                        select: { first_name: true, last_name: true }
                    }
                }
            }),
            this.prisma.blogs.count({ where: whereClause })
        ]);

        console.log('[Blogs Service] Found blogs:', data.length, 'Total:', total);

        return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    async findAll(page: number, limit: number) {
        const skip = (page - 1) * limit;
        const [data, total] = await Promise.all([
            this.prisma.blogs.findMany({
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: {
                    users: {
                        select: { first_name: true, last_name: true, email: true, role: true }
                    }
                }
            }),
            this.prisma.blogs.count()
        ]);

        return {
            data: data.map(b => ({
                ...b,
                author: b.users,
                users: undefined
            })),
            total
        };
    }

    async findOne(idOrSlug: string) {
        // Try by ID if UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

        if (isUuid) {
            const blog = await this.prisma.blogs.findUnique({
                where: { id: idOrSlug },
                include: { users: { select: { first_name: true, last_name: true } } }
            });
            if (!blog) return null;
            return { ...blog, author: blog.users, users: undefined };
        }

        const blog = await this.prisma.blogs.findUnique({
            where: { slug: idOrSlug },
            include: { users: { select: { first_name: true, last_name: true } } }
        });
        if (!blog) return null;
        return { ...blog, author: blog.users, users: undefined };
    }

    async findOneById(id: string) {
        // Fetch blog by ID only (used for 301 redirects)
        const blog = await this.prisma.blogs.findUnique({
            where: { id },
            include: { users: { select: { first_name: true, last_name: true } } }
        });
        if (!blog) return null;
        return { ...blog, author: blog.users, users: undefined };
    }

    async update(id: string, updateBlogDto: any) {
        const data: any = {};
        if (updateBlogDto.title) {
            data.title = updateBlogDto.title;
            // Optionally update slug if title changes
            let slug = updateBlogDto.title
                .toLowerCase()
                .trim()
                .replace(/[^\w\s-]/g, '')
                .replace(/[\s_-]+/g, '-')
                .replace(/^-+|-+$/g, '');

            const existing = await this.prisma.blogs.findFirst({ 
                where: { 
                    slug,
                    id: { not: id }
                } 
            });
            if (existing) {
                slug = `${slug}-${Date.now()}`;
            }
            data.slug = slug;
        }
        if (updateBlogDto.excerpt) data.excerpt = updateBlogDto.excerpt;
        if (updateBlogDto.content) data.content = updateBlogDto.content;
        if (updateBlogDto.imageUrl) data.image_url = updateBlogDto.imageUrl;
        if (updateBlogDto.category) data.category = updateBlogDto.category;
        if (updateBlogDto.status) data.status = updateBlogDto.status;

        return this.prisma.blogs.update({
            where: { id },
            data,
        });
    }

    async updateStatus(id: string, status: string) {
        if (!['PUBLISHED', 'PENDING', 'REJECTED'].includes(status)) {
            throw new BadRequestException('Invalid status');
        }
        
        console.log(`[Blogs Service] Updating blog ${id} status to: ${status}`);
        
        return this.prisma.blogs.update({
            where: { id },
            data: { status }
        });
    }

    // Emergency recovery method - check if any blogs exist
    async emergencyCheck() {
        console.log('[Blogs Service] Emergency check - counting all blogs...');
        const totalBlogs = await this.prisma.blogs.count();
        const publishedBlogs = await this.prisma.blogs.count({ where: { status: 'PUBLISHED' } });
        const pendingBlogs = await this.prisma.blogs.count({ where: { status: 'PENDING' } });
        const rejectedBlogs = await this.prisma.blogs.count({ where: { status: 'REJECTED' } });
        
        console.log(`[Blogs Service] Emergency check results:
        - Total blogs: ${totalBlogs}
        - Published: ${publishedBlogs}
        - Pending: ${pendingBlogs}
        - Rejected: ${rejectedBlogs}
        `);
        
        return {
            total: totalBlogs,
            published: publishedBlogs,
            pending: pendingBlogs,
            rejected: rejectedBlogs
        };
    }
}
