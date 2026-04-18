import { Test, TestingModule } from '@nestjs/testing';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { clerkClient } from '@clerk/clerk-sdk-node';

jest.mock('@clerk/clerk-sdk-node', () => ({
  clerkClient: {
    verifyToken: jest.fn(),
    users: {
      getUser: jest.fn(),
    },
  },
}));

const mockPrisma = {
  users: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  students: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
};

const mockJwt = { verify: jest.fn() };
const mockSyncClerk = { syncPhoneVerifiedToClerk: jest.fn().mockResolvedValue({}) };

describe('ClerkAuthGuard', () => {
  let guard: ClerkAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClerkAuthGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: SyncClerkMetadataService, useValue: mockSyncClerk },
      ],
    }).compile();

    guard = module.get<ClerkAuthGuard>(ClerkAuthGuard);
    jest.clearAllMocks();
  });

  const mockExecutionContext = (authHeader: string | undefined): Partial<ExecutionContext> => ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: authHeader },
        url: '/test-path',
      }),
    }),
  } as any);

  it('should throw UnauthorizedException if no token provided', async () => {
    const context = mockExecutionContext(undefined);
    await expect(guard.canActivate(context as ExecutionContext)).rejects.toThrow(UnauthorizedException);
  });

  it('should verify token via Clerk and link existing user', async () => {
    const context = mockExecutionContext('Bearer clerk_token');
    const mockClaims = { sub: 'user_123', email: 'test@example.com' };
    const mockUser = { id: 'uuid-123', email: 'test@example.com', role: 'student' };

    (clerkClient as any).verifyToken.mockResolvedValue(mockClaims);
    mockPrisma.users.findUnique.mockResolvedValue(mockUser);
    mockPrisma.students.findUnique.mockResolvedValue({ id: 'student-1' });

    const result = await guard.canActivate(context as ExecutionContext);

    expect(result).toBe(true);
    expect(clerkClient.verifyToken).toHaveBeenCalledWith('clerk_token');
    expect(mockPrisma.users.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
  });

  it('should fallback to JWT if Clerk verification fails', async () => {
    const context = mockExecutionContext('Bearer jwt_token');
    const mockClaims = { sub: 'user_123', email: 'test@example.com' };
    const mockUser = { id: 'uuid-123', email: 'test@example.com', role: 'student' };

    (clerkClient as any).verifyToken.mockRejectedValue(new Error('Clerk error'));
    mockJwt.verify.mockReturnValue(mockClaims);
    mockPrisma.users.findUnique.mockResolvedValue(mockUser);
    mockPrisma.students.findUnique.mockResolvedValue({ id: 'student-1' });

    const result = await guard.canActivate(context as ExecutionContext);

    expect(result).toBe(true);
    expect(mockJwt.verify).toHaveBeenCalledWith('jwt_token');
  });
});
