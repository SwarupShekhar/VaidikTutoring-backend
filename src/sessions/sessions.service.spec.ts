import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';
import { AzureStorageService } from '../azure/azure-storage.service';
import { StudentsService } from '../students/students.service';

const mockPrisma = { 
  sessions: { 
    create: jest.fn(), 
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn() 
  },
  class_notes: {
      create: jest.fn(),
      findMany: jest.fn()
  },
  users: {
      findUnique: jest.fn()
  }
};
const mockEmail = { sendEmail: jest.fn() };
const mockJwt = { sign: jest.fn(), verify: jest.fn() };
const mockNotifications = { sendToUser: jest.fn(), server: null };
const mockAzure = { 
    uploadNote: jest.fn(),
    getSignedUrl: jest.fn() 
};
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
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('shareNote', () => {
    const sessionId = 'session-123';
    const userId = 'user-tutor';
    const mockNote = {
        title: 'Whiteboard Annotations',
        noteType: 'whiteboard_pdf',
        buffer: Buffer.from('test'),
        mimeType: 'application/pdf',
        originalName: 'test.pdf'
    };

    it('should upload note to Azure and save record in Prisma', async () => {
        const mockSession = { id: sessionId, student_id: 'student-1' };
        mockPrisma.sessions.findUnique.mockResolvedValue(mockSession);
        mockPrisma.users.findUnique.mockResolvedValue({ id: userId, role: 'tutor' });
        mockAzure.uploadNote.mockResolvedValue('azure-blob-name');
        
        await service.shareNote(
            sessionId,
            userId,
            mockNote.title,
            mockNote.noteType,
            mockNote.buffer,
            mockNote.mimeType,
            mockNote.originalName
        );

        expect(mockAzure.uploadNote).toHaveBeenCalledWith(sessionId, mockNote.buffer, mockNote.mimeType, mockNote.originalName);
        expect(mockPrisma.class_notes.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                session_id: sessionId,
                uploaded_by: userId,
                title: mockNote.title
            })
        }));
    });

    it('should throw error if user is not tutor or admin', async () => {
        const mockSession = { id: sessionId, student_id: 'student-1' };
        mockPrisma.sessions.findUnique.mockResolvedValue(mockSession);
        mockPrisma.users.findUnique.mockResolvedValue({ id: userId, role: 'student' });
        await expect(service.shareNote(
            sessionId,
            userId,
            mockNote.title,
            mockNote.noteType
        )).rejects.toThrow();
    });
  });
});
