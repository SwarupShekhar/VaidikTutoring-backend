import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';
import { AzureStorageService } from '../azure/azure-storage.service';
import { StudentsService } from '../students/students.service';

const mockPrisma = { sessions: { create: jest.fn(), findMany: jest.fn() } };
const mockEmail = { sendEmail: jest.fn() };
const mockJwt = { sign: jest.fn(), verify: jest.fn() };
const mockNotifications = { sendNotification: jest.fn(), server: null };
const mockAzure = { getSignedUrl: jest.fn() };
const mockStudents = { findOne: jest.fn() };

describe('SessionsService', () => {
  let service: SessionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmail },
        { provide: JwtService, useValue: mockJwt },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AzureStorageService, useValue: mockAzure },
        { provide: StudentsService, useValue: mockStudents },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
