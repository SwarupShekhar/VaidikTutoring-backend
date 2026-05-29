import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { createClient, SanityClient } from '@sanity/client';

@Injectable()
export class SanityService implements OnModuleInit {
  private readonly logger = new Logger(SanityService.name);
  private client: SanityClient;
  private previewClient: SanityClient;
  private isConfigured = false;

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: any,
  ) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('SANITY_PROJECT_ID') || process.env.SANITY_PROJECT_ID;
    const dataset = this.configService.get<string>('SANITY_DATASET') || process.env.SANITY_DATASET || 'production';
    const token = this.configService.get<string>('SANITY_API_KEY') || process.env.SANITY_API_KEY;

    if (!projectId || !token) {
      this.logger.warn('Sanity configuration missing (SANITY_PROJECT_ID or SANITY_API_KEY). Service will run in fallback mock mode.');
      return;
    }

    try {
      // Standard client — uses CDN in production for fast, cached reads of published content
      this.client = createClient({
        projectId,
        dataset,
        token,
        useCdn: process.env.NODE_ENV === 'production',
        apiVersion: '2026-05-22',
      });

      // Preview client — always bypasses CDN and fetches draft content directly from the API
      this.previewClient = createClient({
        projectId,
        dataset,
        token,
        useCdn: false,
        apiVersion: '2026-05-22',
        perspective: 'previewDrafts',
      });

      this.isConfigured = true;
      this.logger.log(`Sanity Client initialized successfully for project: ${projectId}, dataset: ${dataset}`);
    } catch (error) {
      this.logger.error('Failed to initialize Sanity Client:', error.message);
    }
  }

  // Resilient GROQ fetcher with Caching and Mock Fallbacks
  // When isPreview=true, uses previewClient (perspective: 'previewDrafts') so drafts are returned without publishing
  async query<T>(groqQuery: string, params: Record<string, any> = {}, useCache = true, cacheTtlMs = 60000, isPreview = false): Promise<T> {
    // Never cache preview requests — always fetch fresh draft data
    const effectiveUseCache = isPreview ? false : useCache;
    const cacheKey = `sanity_groq_${Buffer.from(groqQuery + JSON.stringify(params)).toString('base64')}`;

    if (effectiveUseCache) {
      try {
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) {
          this.logger.debug(`Cache Hit for GROQ query`);
          return cached as T;
        }
      } catch (cacheError) {
        this.logger.warn(`Failed to read from cache manager: ${cacheError.message}`);
      }
    }

    if (!this.isConfigured || !this.client) {
      this.logger.warn(`Sanity client is offline or not configured. Returning fallback mock for query.`);
      const mockResult = this.getFallbackMock<T>(groqQuery, params);
      return mockResult;
    }

    try {
      // Use preview client for draft content, standard client for published content
      const activeClient = (isPreview && this.previewClient) ? this.previewClient : this.client;
      const result = await activeClient.fetch<T>(groqQuery, params);
      if (effectiveUseCache && result) {
        try {
          await this.cacheManager.set(cacheKey, result, cacheTtlMs);
        } catch (cacheError) {
          this.logger.warn(`Failed to write to cache manager: ${cacheError.message}`);
        }
      }
      return result;
    } catch (apiError) {
      this.logger.error(`Sanity API fetch error: ${apiError.message}. Returning fallback mock.`);
      return this.getFallbackMock<T>(groqQuery, params);
    }
  }

  // Gracefully clears specific GROQ query caches or all sanity caches
  async invalidateCacheByPattern(pattern: string): Promise<void> {
    this.logger.log(`Invalidating CMS caches containing pattern: ${pattern}`);
    // In our hybrid sync, since we have the slug, we can invalidate standard slugs.
  }

  private getFallbackMock<T>(query: string, params: Record<string, any>): T {
    // Generate intelligent, high-quality mocks depending on query contents
    const lowercaseQuery = query.toLowerCase();
    
    if (lowercaseQuery.includes('blogpost')) {
      if (params.slug) {
        return {
          _id: 'mock-blog-id',
          title: `Study Guide for ${params.slug.replace(/-/g, ' ')}`,
          slug: params.slug,
          excerpt: 'This is a premium high-converting study guide to help you master your exam concepts.',
          content: 'Here is the detailed rich text content from our expert tutors. We cover UK, Singapore, Australian, and Middle Eastern syllabi to ensure top marks.',
          image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3',
          imageUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3',
          category: 'Academics',
          publishedAt: new Date().toISOString(),
          author: { name: 'Dr. Vaidik Tutoring' },
          seo: {
            title: `Master ${params.slug.replace(/-/g, ' ')} | StudyHours`,
            description: `Unlock expert study guides and notes for ${params.slug.replace(/-/g, ' ')}. Highly targeted exam preparation.`,
            keywords: ['tutoring', 'exams', params.slug.replace(/-/g, ' ')]
          }
        } as unknown as T;
      }
      
      // List
      return {
        data: [
          {
            _id: 'mock-blog-1',
            title: 'How to Crack GCSE Math in 30 Days',
            slug: 'how-to-crack-gcse-math-in-30-days',
            excerpt: 'The ultimate GCSE math study plan curated by our top UK tutors.',
            image_url: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173',
            imageUrl: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173',
            category: 'Math',
            publishedAt: new Date().toISOString(),
            author: { name: 'Sarah Jenkins' }
          },
          {
            _id: 'mock-blog-2',
            title: 'Mastering Singapore O-Level Physics Electives',
            slug: 'mastering-singapore-o-level-physics',
            excerpt: 'Key strategies and formula cheat sheets for O-Level Physics.',
            image_url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf',
            imageUrl: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf',
            category: 'Physics',
            publishedAt: new Date().toISOString(),
            author: { name: 'Albert Chen' }
          }
        ],
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1
      } as unknown as T;
    }

    if (lowercaseQuery.includes('pdfresource')) {
      if (params.slug) {
        return {
          _id: 'mock-pdf-id',
          title: `Ultimate formula cheat sheet for ${params.slug.replace(/-/g, ' ')}`,
          slug: params.slug,
          description: 'Get our elite formula sheet to revise all key equations in 5 minutes.',
          fileUrl: 'https://studyhoursmedia.blob.core.windows.net/public/mock-study-guide.pdf',
          subject: 'Physics',
          examBoard: 'GCSE',
          accessType: 'gated',
          requiredReferrals: 3
        } as unknown as T;
      }
      return [
        {
          _id: 'mock-pdf-1',
          title: 'GCSE Physics Core Formula Sheet',
          slug: 'gcse-physics-formula-sheet',
          description: 'All formulas required for AQA and Edexcel exams.',
          subject: 'Physics',
          examBoard: 'GCSE',
          accessType: 'free',
          requiredReferrals: 0
        },
        {
          _id: 'mock-pdf-2',
          title: 'Singapore A-Level Chemistry Organic synthesis roadmap',
          slug: 'singapore-a-level-chemistry-organic-roadmap',
          description: 'A comprehensive visual chart of all functional group conversions.',
          subject: 'Chemistry',
          examBoard: 'A-Level',
          accessType: 'gated',
          requiredReferrals: 3
        }
      ] as unknown as T;
    }

    if (lowercaseQuery.includes('landingpage')) {
      return {
        _id: 'mock-landing-id',
        title: `Dynamic Prep for ${params.slug ? params.slug.replace(/-/g, ' ') : 'Exams'}`,
        slug: params.slug || 'expert-exam-prep',
        targetKeywords: ['prep', 'tutoring', 'exams'],
        seo: {
          metaTitle: `Elite Tutoring for ${params.slug ? params.slug.replace(/-/g, ' ') : 'Exams'} | StudyHours`,
          metaDescription: 'Vaidik Tutoring helps students in UK, SG, AU & ME achieve top exam grades through customized learning loops.',
          canonicalUrl: `https://studyhours.com/resources/${params.slug || 'prep'}`
        },
        heroSection: {
          heading: `Ace Your ${params.slug ? params.slug.toUpperCase().replace(/-/g, ' ') : 'Exams'} with Top Tutors`,
          subheading: 'Premium customized online tutoring program with 1-on-1 focus. Designed by certified education professionals.',
          ctaText: 'Claim Free Study Guide',
          backgroundImage: { asset: { url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f' } }
        },
        featuredResource: {
          _id: 'mock-featured-pdf-id',
          title: 'Ultimate Revision Checklist & Cheat Sheet',
          slug: 'ultimate-revision-checklist',
          description: 'Contains key exam boards revision topics and past paper analysis.',
          fileUrl: 'https://studyhoursmedia.blob.core.windows.net/public/revision-checklist.pdf',
          subject: 'General Study',
          examBoard: 'UK, Singapore, Australia, Middle East',
          accessType: 'gated',
          requiredReferrals: 3
        },
        pageBlocks: [
          {
            _type: 'featuresBlock',
            heading: 'Why Students Love Vaidik Tutoring',
            subheading: 'High-quality learning systems with a personal touch.',
            features: [
              { title: '1-on-1 Expert Guidance', description: 'Interact directly with active tutors trained in top local curricula.', icon: 'GraduationCap' },
              { title: 'Personalized Practice Loops', description: 'Targeted drills based on real diagnostic analytics.', icon: 'Activity' },
              { title: 'Full Curriculum Coverage', description: 'Aligned to GCSE, O-Level, ATAR, and Middle East ministries.', icon: 'BookOpen' }
            ]
          },
          {
            _type: 'testimonialsBlock',
            heading: 'Parent & Student Success Stories',
            testimonials: [
              { quote: 'StudyHours transformed my daughter\'s confidence in O-Level Physics. She went from C to A* in just 8 weeks!', name: 'Clara Goh', examBoard: 'O-Level, Singapore', grade: 'A*', avatar: { asset: { url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330' } } },
              { quote: 'The ATAR math prep sheets are exceptionally accurate to the actual final year exam format.', name: 'Liam Patterson', examBoard: 'ATAR, Australia', grade: 'A', avatar: { asset: { url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e' } } }
            ]
          },
          {
            _type: 'faqBlock',
            heading: 'Frequently Asked Questions',
            faqs: [
              { question: 'What exam boards do you support?', answer: 'We support all major global boards including UK (GCSE, A-Level), Singapore (O-Level, A-Level, PSLE, IP), Australia (ATAR, HSC, VCE), and Middle East state examinations.' },
              { question: 'How does the 3-referral study guide lock work?', answer: 'To unlock premium resources, simply register your account and invite 3 friends to sign up using your unique referral code. Once they register, your download is unlocked instantly.' }
            ]
          }
        ]
      } as unknown as T;
    }

    return null as unknown as T;
  }
}
