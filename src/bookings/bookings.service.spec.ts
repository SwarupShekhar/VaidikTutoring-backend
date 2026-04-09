import { Test, TestingModule } from '@nestjs/testing';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreditsService } from '../credits/credits.service';
import { AzureStorageService } from '../azure/azure-storage.service';

const mockPrisma = { bookings: { create: jest.fn(), findMany: jest.fn() } };
const mockEmail = { sendEmail: jest.fn() };
const mockNotifications = { sendNotification: jest.fn(), server: null };
const mockCredits = { deductCredits: jest.fn() };
const mockAzure = { getSignedUrl: jest.fn() };

describe('BookingsService', () => {
  let service: BookingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmail },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: CreditsService, useValue: mockCredits },
        { provide: AzureStorageService, useValue: mockAzure },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
