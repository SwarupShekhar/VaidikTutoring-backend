import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CreateBlogDto } from './dto/create-blog.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class BlogsService {
    private readonly logger = new Logger(BlogsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService
    ) { }

    async create(createBlogDto: CreateBlogDto, user: any) {
        // Admin gets PUBLISHED immediately, Tutor gets PENDING
        const initialStatus = user.role === 'admin' ? 'PUBLISHED' : 'PENDING';

        // Slug Handling: Use provided slug or generate from title
        let slug = createBlogDto.slug;
        if (!slug) {
            slug = createBlogDto.title
                .toLowerCase()
                .trim()
                .replace(/[^\w\s-]/g, '')
                .replace(/[\s_-]+/g, '-')
                .replace(/^-+|-+$/g, '');
        }

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
                seo_title: createBlogDto.seoTitle,
                seo_description: createBlogDto.seoDescription,
                target_keyword: createBlogDto.targetKeyword,
                related_blog_ids: createBlogDto.related_blog_ids || [],
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
                seo_title: blog.seo_title,
                seo_description: blog.seo_description,
                target_keyword: blog.target_keyword,
                related_blog_ids: blog.related_blog_ids,
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

        this.logger.debug(`Fetching blogs skip=${skip} limit=${limit}`);

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

        this.logger.debug(`Found ${data.length} blogs, total=${total}`);

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
        if (updateBlogDto.title || updateBlogDto.slug) {
            let slug = updateBlogDto.slug;
            
            // If no slug provided but title is, regenerate it
            if (!slug && updateBlogDto.title) {
                slug = updateBlogDto.title
                    .toLowerCase()
                    .trim()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/[\s_-]+/g, '-')
                    .replace(/^-+|-+$/g, '');
            }

            if (slug) {
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
            if (updateBlogDto.title) data.title = updateBlogDto.title;
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
        if (updateBlogDto.seoTitle !== undefined) data.seo_title = updateBlogDto.seoTitle;
        if (updateBlogDto.seoDescription !== undefined) data.seo_description = updateBlogDto.seoDescription;
        if (updateBlogDto.targetKeyword !== undefined) data.target_keyword = updateBlogDto.targetKeyword;
        if (updateBlogDto.related_blog_ids !== undefined) data.related_blog_ids = updateBlogDto.related_blog_ids;
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
                this.logger.error('Failed to delete old image after successful blog update', e);
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
                seo_title: blog.seo_title,
                seo_description: blog.seo_description,
                target_keyword: blog.target_keyword,
                related_blog_ids: blog.related_blog_ids,
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
                image_alt: version.image_alt,
                seo_title: version.seo_title,
                seo_description: version.seo_description,
                target_keyword: version.target_keyword,
                related_blog_ids: version.related_blog_ids,
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
                image_alt: version.image_alt,
                seo_title: version.seo_title,
                seo_description: version.seo_description,
                target_keyword: version.target_keyword,
                related_blog_ids: version.related_blog_ids,
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
        
        this.logger.log(`Updating blog ${id} status to: ${status}`);
        
        return this.prisma.blogs.update({
            where: { id },
            data: { status }
        });
    }

    // Emergency recovery method - check if any blogs exist
    async emergencyCheck() {
        this.logger.log('Emergency check - counting all blogs...');
        const totalBlogs = await this.prisma.blogs.count();
        const publishedBlogs = await this.prisma.blogs.count({ where: { status: 'PUBLISHED' } });
        const pendingBlogs = await this.prisma.blogs.count({ where: { status: 'PENDING' } });
        const rejectedBlogs = await this.prisma.blogs.count({ where: { status: 'REJECTED' } });

        this.logger.log(`Emergency check: total=${totalBlogs} published=${publishedBlogs} pending=${pendingBlogs} rejected=${rejectedBlogs}`);
        
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
                this.logger.error(`Failed to delete image file: ${blog.image_url}`, error);
            }
        }

        return { message: 'Blog deleted successfully', id: result.id };
    }

    async getInternalLinks() {
        // 1. Core Site Pages
        const sitePages = [
            { title: 'Homepage', url: '/' },
            { title: 'Pricing', url: '/pricing' },
            { title: 'Methodology', url: '/methodology' },
            { title: 'About Us', url: '/about' },
            { title: 'Demo Booking', url: '/demo' },
        ];

        // 2. Curriculum Pillars (Adding these for more granular linking)
        const curricula = await this.prisma.curricula.findMany({
            select: { id: true, name: true }
        });
        const curriculaPages = curricula.map(c => ({
            title: `${c.name} Tutoring`,
            url: `/${c.id.toLowerCase()}-online-tutoring`
        }));

        // 3. Published Blogs
        const publishedBlogs = await this.prisma.blogs.findMany({
            where: { status: 'PUBLISHED' },
            select: {
                title: true,
                slug: true,
            },
            orderBy: { created_at: 'desc' },
            take: 50 // Limit for performance
        });

        const blogPosts = publishedBlogs.map(blog => ({
            title: blog.title,
            url: `/blogs/${blog.slug}`
        }));

        const response: Record<string, { title: string; url: string }[]> = {
            'Site Pages': sitePages,
            'Curriculum Pillars': curriculaPages,
            'Blog Posts': blogPosts,
        };

        // Filter out empty categories to keep UI clean
        return Object.fromEntries(
            Object.entries(response).filter(([_, items]) => items.length > 0)
        );
    }
}
