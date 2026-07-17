import { Test, TestingModule } from '@nestjs/testing';
import { CmsController } from './cms.controller';
import { SanityService } from './sanity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata';
import { UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('CmsController', () => {
  let controller: CmsController;
  let prisma: PrismaService;
  let sanityService: SanityService;

  const mockWebhookSecret = 'vaidiktutoring_cms_secret';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CmsController],
      providers: [
        {
          provide: SanityService,
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            users: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            blogs: {
              upsert: jest.fn(),
            },
            blog_versions: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(),
          },
        },
        {
          provide: SyncClerkMetadataService,
          useValue: {
            syncPhoneVerifiedToClerk: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CmsController>(CmsController);
    prisma = module.get<PrismaService>(PrismaService);
    sanityService = module.get<SanityService>(SanityService);

    process.env.SANITY_WEBHOOK_SECRET = mockWebhookSecret;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Webhook Sync', () => {
    it('should throw UnauthorizedException if webhook secret is missing or incorrect', async () => {
      const req = { headers: {} };
      const payload = { _id: 'blog-1', _type: 'blogPost' };

      await expect(
        controller.handleSanityWebhook('wrong-secret', req, payload),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should skip sync for draft documents starting with drafts.', async () => {
      const req = { headers: { 'x-webhook-secret': mockWebhookSecret } };
      const payload = { _id: 'drafts.blog-1', _type: 'blogPost' };

      const result = await controller.handleSanityWebhook(
        mockWebhookSecret,
        req,
        payload,
      );

      expect(result).toEqual({ success: true, message: 'Draft sync skipped.' });
      expect(prisma.blogs.upsert).not.toHaveBeenCalled();
    });

    it('should successfully sync a valid published blogPost document', async () => {
      const req = { headers: { 'x-webhook-secret': mockWebhookSecret } };
      const payload = {
        _id: 'blog-1',
        _type: 'blogPost',
        title: 'Mastering Math',
        slug: 'mastering-math',
        excerpt: 'Learn visual calculus in 30 minutes.',
        body: [
          {
            _type: 'block',
            children: [{ text: 'Visual calculus is standard at StudyHours.' }],
          },
        ],
        mainImage: {
          asset: { url: 'https://images.unsplash.com/custom' },
          alt: 'Calculus Graph',
        },
        category: 'Calculus',
        seo: {
          title: 'Mastering Math SEO',
          description: 'Calculus descriptions',
          keywords: ['math', 'calculus'],
        },
        publishedAt: '2026-05-22T12:00:00Z',
      };

      const mockAuthor = { id: 'd3b07384-d113-4959-b1d5-be456e72b4c5', role: 'admin' };
      const mockBlog = { id: 'a5c07384-e113-4959-b1d5-ce456e72b4c5', title: 'Mastering Math' };

      (prisma.users.findFirst as jest.Mock).mockResolvedValue(mockAuthor);
      (prisma.blogs.upsert as jest.Mock).mockResolvedValue(mockBlog);

      const result = await controller.handleSanityWebhook(
        mockWebhookSecret,
        req,
        payload,
      );

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { role: 'admin' },
      });

      expect(prisma.blogs.upsert).toHaveBeenCalledWith({
        where: { slug: 'mastering-math' },
        update: expect.any(Object),
        create: expect.any(Object),
      });

      expect(prisma.blog_versions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          blog_id: mockBlog.id,
          title: 'Mastering Math',
          summary: 'Synchronized via Sanity Webhook Sync',
        }),
      });

      expect(result).toEqual({ success: true, blogId: mockBlog.id, action: 'sync' });
    });

    it('should throw BadRequestException if author cannot be resolved', async () => {
      const req = { headers: { 'x-webhook-secret': mockWebhookSecret } };
      const payload = {
        _id: 'blog-1',
        _type: 'blogPost',
        title: 'Mastering Math',
        slug: 'mastering-math',
      };

      (prisma.users.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        controller.handleSanityWebhook(mockWebhookSecret, req, payload),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyReferralsAndUnlock', () => {
    const mockRequest = {
      user: {
        sub: 'user_123',
      },
    };

    it('should throw NotFoundException if resource slug does not exist', async () => {
      (sanityService.query as jest.Mock).mockResolvedValue(null);

      await expect(
        controller.verifyReferralsAndUnlock('invalid-slug', mockRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it('should instantly unlock if resource accessType is free', async () => {
      const mockResource = {
        _id: 'res_1',
        title: 'Free Cheat Sheet',
        accessType: 'free',
        requiredReferrals: 0,
        fileUrl: 'https://studyhours.com/free.pdf',
      };

      (sanityService.query as jest.Mock).mockResolvedValue(mockResource);

      const result = await controller.verifyReferralsAndUnlock(
        'free-cheat-sheet',
        mockRequest,
      );

      expect(result).toEqual({
        unlocked: true,
        referralsCount: 0,
        requiredReferrals: 0,
        fileUrl: 'https://studyhours.com/free.pdf',
      });
    });

    it('should unlock and return fileUrl if user has enough referrals', async () => {
      const mockResource = {
        _id: 'res_2',
        title: 'Gated Cheat Sheet',
        accessType: 'gated',
        requiredReferrals: 3,
        fileUrl: 'https://studyhours.com/gated.pdf',
      };

      (sanityService.query as jest.Mock).mockResolvedValue(mockResource);
      (prisma.users.count as jest.Mock).mockResolvedValue(4); // User has 4 referrals

      const result = await controller.verifyReferralsAndUnlock(
        'gated-cheat-sheet',
        mockRequest,
      );

      expect(prisma.users.count).toHaveBeenCalledWith({
        where: { referred_by: 'user_123' },
      });

      expect(result).toEqual({
        unlocked: true,
        referralsCount: 4,
        requiredReferrals: 3,
        fileUrl: 'https://studyhours.com/gated.pdf',
      });
    });

    it('should return locked and hide fileUrl if user does not have enough referrals', async () => {
      const mockResource = {
        _id: 'res_2',
        title: 'Gated Cheat Sheet',
        accessType: 'gated',
        requiredReferrals: 3,
        fileUrl: 'https://studyhours.com/gated.pdf',
      };

      (sanityService.query as jest.Mock).mockResolvedValue(mockResource);
      (prisma.users.count as jest.Mock).mockResolvedValue(1); // User has 1 referral

      const result = await controller.verifyReferralsAndUnlock(
        'gated-cheat-sheet',
        mockRequest,
      );

      expect(result).toEqual({
        unlocked: false,
        referralsCount: 1,
        requiredReferrals: 3,
        fileUrl: null,
      });
    });
  });

  describe('attributeReferral', () => {
    const req = { user: { sub: 'user_123' } };

    it('rejects self-referral without touching the DB', async () => {
      const result = await controller.attributeReferral({ referredBy: 'user_123' }, req);
      expect(result).toEqual({ attributed: false });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('is a no-op when already attributed', async () => {
      (prisma.users.findUnique as jest.Mock).mockResolvedValueOnce({ referred_by: 'someone_else' });
      const result = await controller.attributeReferral({ referredBy: 'inviter_1' }, req);
      expect(result).toEqual({ attributed: false });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('rejects an inviter that does not exist', async () => {
      (prisma.users.findUnique as jest.Mock)
        .mockResolvedValueOnce({ referred_by: null }) // current user, unattributed
        .mockResolvedValueOnce(null); // inviter lookup
      const result = await controller.attributeReferral({ referredBy: 'ghost' }, req);
      expect(result).toEqual({ attributed: false });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('attributes a valid first-time referral', async () => {
      (prisma.users.findUnique as jest.Mock)
        .mockResolvedValueOnce({ referred_by: null }) // current user, unattributed
        .mockResolvedValueOnce({ id: 'inviter_1' }); // inviter exists
      const result = await controller.attributeReferral({ referredBy: 'inviter_1' }, req);
      expect(result).toEqual({ attributed: true });
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 'user_123' },
        data: { referred_by: 'inviter_1' },
      });
    });
  });
});
