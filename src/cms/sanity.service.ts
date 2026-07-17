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
      this.logger.warn(`Sanity client is offline or not configured. Returning null.`);
      return null as unknown as T;
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
      this.logger.error(`Sanity API fetch error: ${apiError.message}. Throwing error.`);
      throw apiError;
    }
  }

  // Gracefully clears specific GROQ query caches or all sanity caches
  async invalidateCacheByPattern(pattern: string): Promise<void> {
    this.logger.log(`Invalidating CMS caches containing pattern: ${pattern}`);
    // Left intentionally empty or to be implemented later
  }
}
