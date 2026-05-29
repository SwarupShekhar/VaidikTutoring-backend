import { Injectable, Logger, BadRequestException, Inject, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CreateBlogDto } from './dto/create-blog.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import sanitizeHtml = require('sanitize-html');

const SANITIZE_OPTIONS = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'br', 'span', 'div']),
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['class', 'style', 'id'],
        'img': ['src', 'alt', 'width', 'height']
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data']
};

@Injectable()
export class BlogsService {
    private readonly logger = new Logger(BlogsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
        @Inject(CACHE_MANAGER) private cacheManager: any,
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
                content: sanitizeHtml(createBlogDto.content, SANITIZE_OPTIONS),
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
                summary: createBlogDto.summary || 'Initial version',
                author_id: user.sub || user.userId,
            }
        });

        // Clear cache
        await this.clearBlogCaches(blog.slug);

        return blog;
    }

    async findAllPublished(page: number, limit: number, category?: string) {
        const cacheKey = `blogs_published_${page}_${limit}_${category || 'all'}`;
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) return cached;

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

        this.logger.debug(`DB HIT: Fetching blogs skip=${skip} limit=${limit}`);

        const [data, total] = await Promise.all([
            this.prisma.blogs.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    excerpt: true,
                    category: true,
                    image_url: true,
                    image_alt: true,
                    published_at: true,
                    created_at: true,
                    author_id: true,
                    users: {
                        select: { first_name: true, last_name: true }
                    }
                }
            }),
            this.prisma.blogs.count({ where: whereClause })
        ]);

        const result = { data, total, page, limit, totalPages: Math.ceil(total / limit) };
        await this.cacheManager.set(cacheKey, result, 300000); // 5 mins
        return result;
    }

    async findAll(page: number, limit: number, user: any) {
        const skip = (page - 1) * limit;
        const whereClause = user.role === 'tutor' ? { author_id: user.userId } : {};
        const [data, total] = await Promise.all([
            this.prisma.blogs.findMany({
                where: whereClause,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: {
                    users: {
                        select: { first_name: true, last_name: true, email: true, role: true }
                    }
                }
            }),
            this.prisma.blogs.count({ where: whereClause })
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

    async findOne(idOrSlug: string, previewSecret?: string) {
        // Try by ID if UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

        let blog;
        if (isUuid) {
            blog = await this.prisma.blogs.findUnique({
                where: { id: idOrSlug },
                include: { users: { select: { first_name: true, last_name: true } } }
            });
        } else {
            blog = await this.prisma.blogs.findUnique({
                where: { slug: idOrSlug },
                include: { users: { select: { first_name: true, last_name: true } } }
            });
        }

        if (!blog) return null;

        // Secure Draft Preview: Restrict access to unpublished blogs unless matching secret is provided
        if (blog.status !== 'PUBLISHED') {
            const systemPreviewSecret = process.env.PREVIEW_SECRET;
            if (!systemPreviewSecret || !previewSecret || previewSecret !== systemPreviewSecret) {
                throw new UnauthorizedException('Unauthorized to view draft/unpublished content');
            }
        }

        return { ...blog, author: blog.users, users: undefined };
    }

    async findOneById(id: string, previewSecret?: string, user?: any) {
        // Fetch blog by ID only (used for 301 redirects)
        const blog = await this.prisma.blogs.findUnique({
            where: { id },
            include: { users: { select: { first_name: true, last_name: true } } }
        });
        if (!blog) return null;

        // Secure Draft Preview: Restrict access to unpublished blogs unless matching secret is provided
        if (blog.status !== 'PUBLISHED') {
            const isAuthorizedUser = user && (user.role === 'admin' || blog.author_id === user.id);
            if (!isAuthorizedUser) {
                const systemPreviewSecret = process.env.PREVIEW_SECRET;
                if (!systemPreviewSecret || !previewSecret || previewSecret !== systemPreviewSecret) {
                    throw new UnauthorizedException('Unauthorized to view draft/unpublished content');
                }
            }
        }

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
        if (updateBlogDto.content) data.content = sanitizeHtml(updateBlogDto.content, SANITIZE_OPTIONS);
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
        if (updateBlogDto.status) {
            if (user.role === 'tutor' && updateBlogDto.status === 'PUBLISHED') {
                data.status = 'PENDING';
            } else {
                data.status = updateBlogDto.status;
            }
        }

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

        // Clear cache
        await this.clearBlogCaches(blog.slug);

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

        // Clear cache
        await this.clearBlogCaches(restoredBlog.slug);

        return restoredBlog;
    }

    async updateStatus(id: string, status: string, reason?: string, user?: any) {
        if (!['PUBLISHED', 'PENDING', 'REJECTED'].includes(status)) {
            throw new BadRequestException('Invalid status');
        }
        
        this.logger.log(`Updating blog ${id} status to: ${status}`);
        
        const updatedBlog = await this.prisma.blogs.update({
            where: { id },
            data: { status }
        });

        if (status === 'REJECTED' && reason && user) {
            await this.prisma.blog_versions.create({
                data: {
                    blog_id: id,
                    title: updatedBlog.title,
                    excerpt: updatedBlog.excerpt,
                    content: updatedBlog.content,
                    image_url: updatedBlog.image_url,
                    category: updatedBlog.category,
                    image_alt: updatedBlog.image_alt,
                    seo_title: updatedBlog.seo_title,
                    seo_description: updatedBlog.seo_description,
                    target_keyword: updatedBlog.target_keyword,
                    related_blog_ids: updatedBlog.related_blog_ids,
                    summary: `REJECTED: ${reason}`,
                    author_id: user.sub || user.userId || updatedBlog.author_id,
                }
            });
        }

        // Clear cache
        await this.clearBlogCaches(updatedBlog.slug);

        return updatedBlog;
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

        // Clear cache
        await this.clearBlogCaches(blog.slug);

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

    private async clearBlogCaches(slug?: string) {
        this.logger.log(`Clearing blog caches ${slug ? `for slug: ${slug}` : ''}`);
        
        try {
            // 1. Clear Backend manual caches and CacheInterceptor caches
            const store = (this.cacheManager as any).store;
            
            // Try to find keys by pattern across different store types
            let blogKeys: string[] = [];
            
            if (store && typeof store.keys === 'function') {
                // Standard cache-manager keys() usually takes a pattern or nothing
                try {
                    const keys = await store.keys('*');
                    blogKeys = keys.filter((key: string) => 
                        key.includes('blogs_published') || 
                        key.includes('/blogs') ||
                        key.includes('/admin/blogs') ||
                        key.includes('blog')
                    );
                } catch (e) {
                    this.logger.warn('Failed to fetch keys with pattern "*", trying without pattern');
                    const keys = await store.keys();
                    blogKeys = keys.filter((key: string) => 
                        key.includes('blogs_published') || 
                        key.includes('/blogs') ||
                        key.includes('/admin/blogs')
                    );
                }
            } else if (store && store.client && typeof store.client.keys === 'function') {
                // Redis specific path
                blogKeys = await store.client.keys('*blog*');
            }

            if (blogKeys.length > 0) {
                this.logger.log(`Deleting ${blogKeys.length} blog cache keys`);
                await Promise.all(blogKeys.map(key => this.cacheManager.del(key)));
            } else {
                // Absolute fallback for specific known keys
                await this.cacheManager.del('blogs_published_list');
            }

            // 2. Trigger Next.js revalidation
            if (slug) {
                await this.triggerRevalidation(slug);
            } else {
                // If no specific slug, at least revalidate the list
                await this.triggerRevalidation('list-update-placeholder'); 
            }
        } catch (error) {
            this.logger.error('Failed to clear blog caches', error);
        }
    }

    private async triggerRevalidation(slug: string) {
        try {
            const revalidateUrl = process.env.REVALIDATION_URL || 'https://studyhours.com/api/revalidate';
            const revalidationSecret = process.env.REVALIDATION_SECRET || 'vaidikeduservicespvtltd_revalidate_2026_key';
            
            // We revalidate both the specific post and the list
            // The frontend revalidate route handles path.includes('/blogs') to revalidate /blogs index
            const url = `${revalidateUrl}?secret=${revalidationSecret}&path=/blogs/${slug}`;
            
            this.logger.log(`Triggering cache revalidation for path: /blogs/${slug}`);
            
            // Fire-and-forget background fetch request
            fetch(url, { method: 'POST' })
                .then(res => {
                    if (res.ok) {
                        this.logger.log(`Successfully revalidated blog cache for path: /blogs/${slug}`);
                    } else {
                        res.text().then(text => {
                            this.logger.error(`Revalidation request failed for /blogs/${slug}: ${res.status} ${text}`);
                        });
                    }
                })
                .catch(err => {
                    this.logger.error(`Network error during cache revalidation for /blogs/${slug}: ${err.message}`);
                });

            // Also explicitly revalidate the /blogs index just in case
            const indexUrl = `${revalidateUrl}?secret=${revalidationSecret}&path=/blogs`;
            fetch(indexUrl, { method: 'POST' }).catch(() => {});
            
        } catch (error: any) {
            this.logger.error(`Failed to dispatch cache revalidation event: ${error?.message}`);
        }
    }
}
