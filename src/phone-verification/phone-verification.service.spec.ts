import { Test } from '@nestjs/testing';
import { PhoneVerificationService } from './phone-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncClerkMetadataService } from '../admin/sync-clerk-metadata';
import { BadRequestException } from '@nestjs/common';

describe('PhoneVerificationService', () => {
  let service: PhoneVerificationService;
  let mockPrisma: any;
  let mockSyncClerk: any;

  beforeEach(async () => {
    mockPrisma = {
      users: {
        update: jest.fn().mockResolvedValue({ id: 'user-1', phone: '+447911123456', phone_verified: true }),
      },
    };
    mockSyncClerk = {
      syncPhoneVerifiedToClerk: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        PhoneVerificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SyncClerkMetadataService, useValue: mockSyncClerk },
      ],
    }).compile();

    service = module.get(PhoneVerificationService);
  });

  const mockTwilioClient = (overrides: object) => {
    Object.defineProperty(service, 'twilioClient', {
      value: overrides,
      writable: true,
      configurable: true,
    });
  };

  describe('sendOtp', () => {
    it('should call Twilio verifications.create with correct params', async () => {
      const mockCreate = jest.fn().mockResolvedValue({ status: 'pending' });
      mockTwilioClient({
        verify: { v2: { services: jest.fn().mockReturnValue({ verifications: { create: mockCreate } }) } },
      });

      await service.sendOtp('+447911123456', 'sms');

      expect(mockCreate).toHaveBeenCalledWith({ to: '+447911123456', channel: 'sms' });
    });
  });

  describe('verifyOtp', () => {
    it('should update DB and sync Clerk when code is approved', async () => {
      const mockCheckCreate = jest.fn().mockResolvedValue({ status: 'approved' });
      mockTwilioClient({
        verify: { v2: { services: jest.fn().mockReturnValue({ verificationChecks: { create: mockCheckCreate } }) } },
      });

      await service.verifyOtp('user-1', '+447911123456', '123456');

      expect(mockPrisma.users.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { phone: '+447911123456', phone_verified: true },
      });
      expect(mockSyncClerk.syncPhoneVerifiedToClerk).toHaveBeenCalledWith('user-1', true);
    });

    it('should throw BadRequestException when code is not approved', async () => {
      const mockCheckCreate = jest.fn().mockResolvedValue({ status: 'pending' });
      mockTwilioClient({
        verify: { v2: { services: jest.fn().mockReturnValue({ verificationChecks: { create: mockCheckCreate } }) } },
      });

      await expect(service.verifyOtp('user-1', '+447911123456', '000000'))
        .rejects.toThrow(BadRequestException);
    });
  });
});
