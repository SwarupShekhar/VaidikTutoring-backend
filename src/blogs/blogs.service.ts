import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class BlogsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService
    ) { }

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

        const blog = await this.prisma.blogs.create({
            data: {
                title: createBlogDto.title,
                excerpt: createBlogDto.excerpt,
                content: createBlogDto.content,
                image_url: createBlogDto.imageUrl,
                category: createBlogDto.category,
                image_alt: createBlogDto.imageAlt,
                slug,
                status: initialStatus,
                published_at: createBlogDto.publishedAt ? new Date(createBlogDto.publishedAt) : new Date(),
                author_id: user.sub || user.userId,
            },
        });

        // Create initial version
        await this.prisma.blog_versions.create({
            data: {
                blog_id: blog.id,
                title: blog.title,
                excerpt: blog.excerpt,
                content: blog.content,
                image_url: blog.image_url,
                category: blog.category,
                image_alt: blog.image_alt,
                summary: 'Initial version',
                author_id: user.sub || user.userId,
            }
        });

        return blog;
    }

    async findAllPublished(page: number, limit: number, category?: string) {
        const skip = (page - 1) * limit;
        const whereClause: any = { 
            status: 'PUBLISHED',
            published_at: {
                lte: new Date()
            }
        };

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
        return { 
            ...blog, 
            author: blog.users, 
            users: undefined,
            author_id: blog.author_id 
        };
    }

    async update(id: string, updateBlogDto: any, user: any) {
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
        let oldImageUrlToDelete: string | null = null;
        if (updateBlogDto.imageUrl) {
            // Capture old image for deletion later if update succeeds
            const oldBlog = await this.prisma.blogs.findUnique({ where: { id } });
            if (oldBlog?.image_url && oldBlog.image_url.startsWith('/uploads/')) {
                oldImageUrlToDelete = oldBlog.image_url;
            }
            data.image_url = updateBlogDto.imageUrl;
        }
        if (updateBlogDto.category) data.category = updateBlogDto.category;
        if (updateBlogDto.imageAlt !== undefined) data.image_alt = updateBlogDto.imageAlt;
        if (updateBlogDto.publishedAt) data.published_at = new Date(updateBlogDto.publishedAt);
        if (updateBlogDto.status) data.status = updateBlogDto.status;

        const blog = await this.prisma.blogs.update({
            where: { id },
            data,
        });

        // Delete old image now that DB update is successful
        if (oldImageUrlToDelete) {
            try {
                await this.storage.deleteFile(oldImageUrlToDelete);
            } catch (e) {
                console.error('Failed to delete old image after successful blog update:', e);
            }
        }

        // Create new version
        await this.prisma.blog_versions.create({
            data: {
                blog_id: id,
                title: blog.title,
                excerpt: blog.excerpt,
                content: blog.content,
                image_url: blog.image_url,
                category: blog.category,
                image_alt: blog.image_alt,
                summary: updateBlogDto.summary || 'Content update',
                author_id: user.sub || user.userId,
            }
        });

        return blog;
    }

    async getVersions(blogId: string) {
        return this.prisma.blog_versions.findMany({
            where: { blog_id: blogId },
            orderBy: { created_at: 'desc' },
            include: {
                author: {
                    select: { first_name: true, last_name: true }
                }
            }
        });
    }

    async restoreVersion(blogId: string, versionId: string, user: any) {
        const version = await this.prisma.blog_versions.findUnique({
            where: { id: versionId }
        });

        if (!version || version.blog_id !== blogId) {
            throw new BadRequestException('Version not found');
        }

        const restoredBlog = await this.prisma.blogs.update({
            where: { id: blogId },
            data: {
                title: version.title,
                excerpt: version.excerpt,
                content: version.content,
                image_url: version.image_url,
                category: version.category,
            }
        });

        // Create a new version for the restoration itself
        await this.prisma.blog_versions.create({
            data: {
                blog_id: blogId,
                title: version.title,
                excerpt: version.excerpt,
                content: version.content,
                image_url: version.image_url,
                category: version.category,
                summary: `Restored to version from ${new Date(version.created_at).toLocaleString()}`,
                author_id: user.sub || user.userId,
            }
        });

        return restoredBlog;
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

    async remove(id: string) {
        const blog = await this.prisma.blogs.findUnique({ where: { id } });
        if (!blog) {
            return { message: 'Blog already deleted or not found' };
        }

        // Delete versions first (required by DB constraint)
        await this.prisma.blog_versions.deleteMany({
            where: { blog_id: id }
        });

        // Delete the main blog
        const result = await this.prisma.blogs.delete({
            where: { id }
        });

        // Delete main image if it exists and is local
        if (blog.image_url && blog.image_url.startsWith('/uploads/')) {
            try {
                await this.storage.deleteFile(blog.image_url);
            } catch (error) {
                console.error(`[Blogs Service] Failed to delete image file: ${blog.image_url}`, error);
            }
        }

        return { message: 'Blog deleted successfully', id: result.id };
    }
}
