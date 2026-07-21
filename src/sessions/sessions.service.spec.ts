import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';
import { AzureStorageService } from '../azure/azure-storage.service';
import { StudentsService } from '../students/students.service';
import { ZoomService } from '../zoom/zoom.service';

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
  session_recordings: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
  },
  users: {
      findUnique: jest.fn()
  },
  tutors: {
      findFirst: jest.fn()
  }
};
const mockEmail = { sendEmail: jest.fn() };
const mockJwt = { sign: jest.fn(), verify: jest.fn() };
const mockNotifications = { sendToUser: jest.fn(), server: null };
const mockAzure = {
    uploadNote: jest.fn(),
    getSignedUrl: jest.fn(),
    generateSasUrl: jest.fn(),
    blobExists: jest.fn(),
};
const mockStudents = { findOne: jest.fn() };
const mockZoom = { createMeeting: jest.fn(), deleteMeeting: jest.fn() };

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
        { provide: ZoomService, useValue: mockZoom },
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
        // Fixture reflects shareNote's tutor-assignment guard: the tutor must be
        // the session's assigned tutor and the session must have occurred.
        const mockSession = {
            id: sessionId,
            student_id: 'student-1',
            status: 'completed',
            bookings: { assigned_tutor_id: 'tutor-1' },
        };
        mockPrisma.sessions.findUnique.mockResolvedValue(mockSession);
        mockPrisma.users.findUnique.mockResolvedValue({ id: userId, role: 'tutor' });
        mockPrisma.tutors.findFirst.mockResolvedValue({ id: 'tutor-1' });
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

  describe('generateRecordingSasUrl (trial read-gate)', () => {
    const sessionId = 'session-rec-1';
    const recordingId = 'rec-1';
    const blobName = 'session-rec-1/123.mp4';

    beforeEach(() => {
      // ensureSessionId() + verifySessionAccess() both call sessions.findUnique;
      // spy verifySessionAccess so we only unit-test the gate, not the whole
      // access chain. ensureSessionId just reads `.id` off the returned row.
      jest.spyOn(service, 'verifySessionAccess').mockResolvedValue(true as any);
      mockPrisma.session_recordings.findUnique.mockResolvedValue({
        id: recordingId,
        session_id: sessionId,
        azure_blob_name: blobName,
      });
      mockPrisma.session_recordings.update.mockResolvedValue({});
      mockAzure.blobExists.mockResolvedValue(true);
      mockAzure.generateSasUrl.mockResolvedValue('https://azure/sas-url');
    });

    it('throws ForbiddenException { locked, UPGRADE_REQUIRED } for a trial student', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({ id: 'user-student', role: 'student' });
      mockPrisma.sessions.findUnique.mockResolvedValue({
        id: sessionId,
        bookings: { students: { is_trial_active: true, enrollment_status: 'trial' } },
      });

      let caught: any;
      try {
        await service.generateRecordingSasUrl(sessionId, recordingId, 'user-student');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught.getStatus()).toBe(403);
      expect(caught.getResponse()).toEqual(
        expect.objectContaining({ locked: true, reason: 'UPGRADE_REQUIRED' }),
      );
      expect(mockAzure.generateSasUrl).not.toHaveBeenCalled();
    });

    it('returns a streamUrl for a paid student', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({ id: 'user-student', role: 'student' });
      mockPrisma.sessions.findUnique.mockResolvedValue({
        id: sessionId,
        bookings: { students: { is_trial_active: false, enrollment_status: 'paid' } },
      });

      const result = await service.generateRecordingSasUrl(sessionId, recordingId, 'user-student');
      expect(result).toEqual({ streamUrl: 'https://azure/sas-url', expiresIn: 3600 });
      expect(mockAzure.generateSasUrl).toHaveBeenCalledWith('session-recordings', blobName, 1);
    });

    it('lets a tutor bypass the gate on a trial student session', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({ id: 'user-tutor', role: 'tutor' });
      mockPrisma.sessions.findUnique.mockResolvedValue({
        id: sessionId,
        bookings: { students: { is_trial_active: true, enrollment_status: 'trial' } },
      });

      const result = await service.generateRecordingSasUrl(sessionId, recordingId, 'user-tutor');
      expect(result.streamUrl).toBe('https://azure/sas-url');
      expect(result.expiresIn).toBe(3600);
    });
  });
});
