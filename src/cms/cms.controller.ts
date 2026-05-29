import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SanityService } from './sanity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Response } from 'express';

@Controller('cms')
export class CmsController {
  private readonly logger = new Logger(CmsController.name);

  constructor(
    private readonly sanityService: SanityService,
    private readonly prisma: PrismaService,
  ) {}

  // 1. Webhook sync endpoint for Hybrid Blogs
  @Post('webhook')
  async handleSanityWebhook(
    @Query('secret') querySecret: string,
    @Req() req: any,
    @Body() payload: any,
  ) {
    const webhookSecret = process.env.SANITY_WEBHOOK_SECRET || 'vaidiktutoring_cms_secret';
    const headerSecret = req.headers['x-webhook-secret'];

    // Verify secret to prevent spam or malicious updates
    if (querySecret !== webhookSecret && headerSecret !== webhookSecret) {
      this.logger.warn('Unauthorized webhook invocation attempt.');
      throw new UnauthorizedException('Invalid webhook secret.');
    }

    this.logger.log(`Received Sanity webhook payload for document ID: ${payload?._id}, type: ${payload?._type}`);

    if (!payload || !payload._type) {
      throw new BadRequestException('Invalid webhook payload structure.');
    }

    // We only sync "blogPost" document types to the PostgreSQL database
    if (payload._type === 'blogPost') {
      const isDraft = payload._id?.startsWith('drafts.');
      
      // If it is a draft, we do not sync it to Postgres as "PUBLISHED"
      if (isDraft) {
        this.logger.log(`Skipping sync for draft document: ${payload._id}`);
        return { success: true, message: 'Draft sync skipped.' };
      }

      const slug = payload.slug?.current || payload.slug;
      if (!slug) {
        throw new BadRequestException('Blog post must have a slug for sync.');
      }

      // Parse payload details
      const title = payload.title || 'Untitled Post';
      const excerpt = payload.excerpt || 'Read our latest blog post to learn more.';
      
      // Handle rich text body converting or stringifying
      let content = '';
      if (typeof payload.body === 'string') {
        content = payload.body;
      } else if (Array.isArray(payload.body)) {
        // Simple PortableText serializer / stringifier to preserve readable paragraphs
        content = payload.body
          .map((block: any) => {
            if (block._type === 'block' && block.children) {
              return block.children.map((c: any) => c.text).join('');
            }
            return '';
          })
          .filter(Boolean)
          .join('\n\n');
      } else {
        content = payload.content || 'Content coming soon.';
      }

      // Main image url parsing
      const imageUrl = payload.mainImage?.asset?.url || payload.imageUrl || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3';
      const imageAlt = payload.mainImage?.alt || payload.imageAlt || title;
      const category = payload.category || 'Academics';
      
      // SEO tags
      const seoTitle = payload.seo?.title || payload.seoTitle || title;
      const seoDescription = payload.seo?.description || payload.seoDescription || excerpt;
      const targetKeyword = payload.seo?.keywords?.[0] || payload.targetKeyword || '';
      const publishedAt = payload.publishedAt ? new Date(payload.publishedAt) : new Date();

      // Find or create default author
      let authorId: string;
      try {
        const defaultAdmin = await this.prisma.users.findFirst({
          where: { role: 'admin' },
        });
        if (defaultAdmin) {
          authorId = defaultAdmin.id;
        } else {
          const anyUser = await this.prisma.users.findFirst();
          if (anyUser) {
            authorId = anyUser.id;
          } else {
            throw new Error('No user exists in the database to assign as author.');
          }
        }
      } catch (err) {
        this.logger.error(`Error resolving author: ${err.message}`);
        throw new BadRequestException(`Author resolution failed: ${err.message}`);
      }

      try {
        // Upsert blog post in Postgres blogs table
        const blog = await this.prisma.blogs.upsert({
          where: { slug },
          update: {
            title,
            excerpt,
            content,
            image_url: imageUrl,
            category,
            image_alt: imageAlt,
            seo_title: seoTitle,
            seo_description: seoDescription,
            target_keyword: targetKeyword,
            published_at: publishedAt,
            status: 'PUBLISHED',
          },
          create: {
            title,
            slug,
            excerpt,
            content,
            image_url: imageUrl,
            category,
            image_alt: imageAlt,
            seo_title: seoTitle,
            seo_description: seoDescription,
            target_keyword: targetKeyword,
            published_at: publishedAt,
            status: 'PUBLISHED',
            author_id: authorId,
          },
        });

        // Add history record in blog_versions
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
            summary: 'Synchronized via Sanity Webhook Sync',
            author_id: authorId,
          },
        });

        this.logger.log(`Successfully synchronized blog post slug: ${slug} (ID: ${blog.id}) to PostgreSQL`);
        return { success: true, blogId: blog.id, action: 'sync' };
      } catch (dbError) {
        this.logger.error(`Database synchronization failed: ${dbError.message}`);
        throw new BadRequestException(`Database sync failed: ${dbError.message}`);
      }
    }

    return { success: true, message: 'Webhook received. Document sync not required for this type.' };
  }

  // 2. GET all dynamic landing pages (for sitemap indexation)
  @Get('landing-pages')
  async getAllLandingPages() {
    const query = `*[_type == "landingPage" && !(_id in path("drafts.**"))] | order(title asc) {
      _id,
      title,
      "slug": slug.current,
      addToFooter
    }`;
    return this.sanityService.query<any[]>(query);
  }

  // 2b. GET programmatic SEO landing page
  @Get('landing-pages/:slug')
  async getLandingPage(
    @Param('slug') slug: string,
    @Query('preview') preview?: string,
  ) {
    const isPreview = preview === 'true';
    const query = `*[_type == "landingPage" && (slug.current == $slug || slug.current == " " + $slug || slug.current == $slug + " " || slug.current == " " + $slug + " ")] | order(_updatedAt desc)[0] {
      _id,
      title,
      "slug": slug.current,
      targetKeywords,
      addToFooter,
      seo {
        metaTitle,
        metaDescription,
        canonicalUrl
      },
      heroSection {
        heading,
        subheading,
        ctaText,
        backgroundImage {
          asset->{
            url
          }
        }
      },
      featuredResource-> {
        _id,
        title,
        "slug": slug.current,
        description,
        "fileUrl": file.asset->url,
        subject,
        examBoard,
        accessType,
        requiredReferrals
      },
      pageBlocks[] {
        _type,
        heading,
        subheading,
        body,
        layout,

        html,
        css,
        scopeClass,
        sectionBackground,
        sectionPadding,
        maxWidth,

        content,

        features[] {
          title,
          description,
          icon
        },

        testimonials[] {
          quote,
          name,
          examBoard,
          grade,
          avatar {
            asset->{ url }
          }
        },

        faqs[] {
          question,
          answer
        },

        stats[] {
          value,
          label,
          icon
        },

        ctaText,
        ctaUrl,
        image {
          asset->{ url },
          alt
        },
        imagePosition,

        variant,

        url,
        caption
      }
    }`;

    const data = await this.sanityService.query<any>(query, { slug }, !isPreview, 60000, isPreview);
    if (!data) {
      throw new NotFoundException(`Landing page with slug '${slug}' not found.`);
    }
    return data;
  }

  // 3. GET all available PDF lead magnet resources
  @Get('resources')
  async getResources() {
    const query = `*[_type == "pdfResource" && !(_id in path("drafts.**"))] | order(title asc) {
      _id,
      title,
      "slug": slug.current,
      description,
      subject,
      examBoard,
      accessType,
      requiredReferrals
    }`;

    return this.sanityService.query<any[]>(query);
  }

  // 4. GET specific resource details
  @Get('resources/:slug')
  async getResource(@Param('slug') slug: string) {
    const query = `*[_type == "pdfResource" && (slug.current == $slug || slug.current == " " + $slug || slug.current == $slug + " " || slug.current == " " + $slug + " ")][0] {
      _id,
      title,
      "slug": slug.current,
      description,
      "fileUrl": file.asset->url,
      subject,
      examBoard,
      accessType,
      requiredReferrals
    }`;

    const resource = await this.sanityService.query<any>(query, { slug });
    if (!resource) {
      throw new NotFoundException(`PDF Resource with slug '${slug}' not found.`);
    }
    return resource;
  }

  // 5. Protected: Verify student referrals and unlock gated resource
  @UseGuards(ClerkAuthGuard)
  @Get('resources/:slug/verify-referral')
  async verifyReferralsAndUnlock(
    @Param('slug') slug: string,
    @Req() req: any,
  ) {
    const userId = req.user.sub || req.user.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required.');
    }

    // 1. Get resource requirements
    const query = `*[_type == "pdfResource" && (slug.current == $slug || slug.current == " " + $slug || slug.current == $slug + " " || slug.current == " " + $slug + " ")][0] {
      _id,
      title,
      accessType,
      requiredReferrals,
      "fileUrl": file.asset->url
    }`;

    const resource = await this.sanityService.query<any>(query, { slug });
    if (!resource) {
      throw new NotFoundException(`PDF Resource with slug '${slug}' not found.`);
    }

    // If it's free or has no referrals required, unlock instantly
    if (resource.accessType !== 'gated' || !resource.requiredReferrals || resource.requiredReferrals <= 0) {
      return {
        unlocked: true,
        referralsCount: 0,
        requiredReferrals: 0,
        fileUrl: resource.fileUrl,
      };
    }

    // 2. Query user invite count in Postgres
    // In our system, parent_id/parent relationships represents family signups,
    // or we can count student/user invitations.
    // Let's perform a dynamic check. We count users whose parent_id matches the current user's ID
    const directInvitesCount = await this.prisma.users.count({
      where: { parent_id: userId },
    });

    // Also check school signups or custom fields. Let's count standard invite signups
    // We will consider direct parent-child invites + any student accounts created via referral
    const isUnlocked = directInvitesCount >= resource.requiredReferrals;

    return {
      unlocked: isUnlocked,
      referralsCount: directInvitesCount,
      requiredReferrals: resource.requiredReferrals,
      fileUrl: isUnlocked ? resource.fileUrl : null,
    };
  }
}
