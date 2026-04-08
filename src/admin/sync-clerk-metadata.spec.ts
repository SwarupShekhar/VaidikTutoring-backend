import { Test } from '@nestjs/testing';
import { SyncClerkMetadataService } from './sync-clerk-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('SyncClerkMetadataService.syncPhoneVerifiedToClerk', () => {
  it('should call updateUserMetadata with phone_verified flag', async () => {
    const mockUpdateMetadata = jest.fn().mockResolvedValue({});
    const mockGetUserList = jest.fn().mockResolvedValue([{ id: 'user_abc123' }]);
    const mockPrisma = {
      users: {
        findUnique: jest.fn().mockResolvedValue({ id: 'db-uuid', email: 'test@example.com' }),
        update: jest.fn().mockResolvedValue({}),
      },
      audit_logs: { create: jest.fn().mockResolvedValue({}) },
    };
    const mockConfig = { get: jest.fn().mockReturnValue('sk_test_123') };

    const module = await Test.createTestingModule({
      providers: [
        SyncClerkMetadataService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    const service = module.get(SyncClerkMetadataService);
    (service as any).clerkClient = {
      users: {
        getUserList: mockGetUserList,
        updateUserMetadata: mockUpdateMetadata,
      },
    };

    await service.syncPhoneVerifiedToClerk('db-uuid', true);

    expect(mockUpdateMetadata).toHaveBeenCalledWith('user_abc123', {
      publicMetadata: { phone_verified: true },
    });
  });
});
