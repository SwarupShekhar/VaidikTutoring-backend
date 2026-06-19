import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';
import { AzureStorageService } from '../azure/azure-storage.service';
import { StudentsService } from '../students/students.service';

/**
 * Focused coverage for the Jun 2026 auto-attendance capture logic
 * (markStudentPresent / markStudentLeft / finalizeSessionAttendance).
 * Exercises the parts most prone to subtle bugs: minute accumulation,
 * reconnect re-anchoring, double-leave idempotency, and the end-of-session
 * finalize backstop. Prisma is fully mocked — no DB required.
 */
const mockPrisma = {
  attendance: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};
const mockEmail = { sendEmail: jest.fn() };
const mockJwt = { sign: jest.fn(), verify: jest.fn() };
const mockNotifications = { sendToUser: jest.fn(), server: null };
const mockAzure = { uploadNote: jest.fn(), getSignedUrl: jest.fn() };
const mockStudents = { findOne: jest.fn() };

const SESSION = 'session-1';
const STUDENT = 'student-1';
const KEY = { sessionId_studentId: { sessionId: SESSION, studentId: STUDENT } };

// Fixed "now" so `new Date()` inside the service is deterministic.
const NOW = new Date('2026-06-19T10:30:00.000Z');

describe('SessionsService — attendance capture', () => {
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
    jest.useFakeTimers().setSystemTime(NOW);
    // Echo back the data so assertions can inspect the persisted shape.
    mockPrisma.attendance.upsert.mockImplementation(({ create }) => create);
    mockPrisma.attendance.update.mockImplementation(({ data }) => data);
  });

  afterEach(() => jest.useRealTimers());

  describe('markStudentPresent', () => {
    it('opens a fresh interval on first join (no existing row)', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue(null);

      await service.markStudentPresent(SESSION, STUDENT);

      expect(mockPrisma.attendance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: KEY,
          create: { sessionId: SESSION, studentId: STUDENT, present: true, joinedAt: NOW, leftAt: null },
          update: { present: true, joinedAt: NOW, leftAt: null },
        }),
      );
    });

    it('re-anchors joinedAt to now when reopening a previously-closed interval', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue({
        joinedAt: new Date('2026-06-19T09:00:00.000Z'),
        leftAt: new Date('2026-06-19T09:20:00.000Z'),
        minutesAttended: 20,
      });

      await service.markStudentPresent(SESSION, STUDENT);

      const { update } = mockPrisma.attendance.upsert.mock.calls[0][0];
      expect(update.joinedAt).toEqual(NOW); // new interval anchor
      expect(update.leftAt).toBeNull();
    });

    it('preserves the original anchor when an interval is already open (e.g. after restart / 2nd tab)', async () => {
      const openAnchor = new Date('2026-06-19T10:00:00.000Z');
      mockPrisma.attendance.findUnique.mockResolvedValue({
        joinedAt: openAnchor,
        leftAt: null,
        minutesAttended: 0,
      });

      await service.markStudentPresent(SESSION, STUDENT);

      const { update } = mockPrisma.attendance.upsert.mock.calls[0][0];
      expect(update.joinedAt).toEqual(openAnchor); // not re-anchored to NOW
    });
  });

  describe('markStudentLeft', () => {
    it('is a no-op when the student was never marked present', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue(null);

      const result = await service.markStudentLeft(SESSION, STUDENT);

      expect(result).toBeNull();
      expect(mockPrisma.attendance.update).not.toHaveBeenCalled();
    });

    it('accumulates minutes for the just-ended interval and stamps leftAt', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue({
        joinedAt: new Date('2026-06-19T10:00:00.000Z'), // 30 min before NOW
        leftAt: null,
        minutesAttended: 0,
      });

      await service.markStudentLeft(SESSION, STUDENT);

      expect(mockPrisma.attendance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: KEY,
          data: { leftAt: NOW, minutesAttended: 30 },
        }),
      );
    });

    it('adds to existing minutes across multiple visits (never overwrites)', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue({
        joinedAt: new Date('2026-06-19T10:20:00.000Z'), // 10 min before NOW
        leftAt: null,
        minutesAttended: 25, // earlier visit already banked
      });

      await service.markStudentLeft(SESSION, STUDENT);

      expect(mockPrisma.attendance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { leftAt: NOW, minutesAttended: 35 } }),
      );
    });

    it('is idempotent — a duplicate leave on an already-closed interval does not double-count', async () => {
      const closed = {
        joinedAt: new Date('2026-06-19T10:00:00.000Z'),
        leftAt: new Date('2026-06-19T10:25:00.000Z'),
        minutesAttended: 25,
      };
      mockPrisma.attendance.findUnique.mockResolvedValue(closed);

      const result = await service.markStudentLeft(SESSION, STUDENT);

      expect(mockPrisma.attendance.update).not.toHaveBeenCalled();
      expect(result).toBe(closed);
    });

    it('never produces negative minutes under clock skew (future joinedAt)', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue({
        joinedAt: new Date('2026-06-19T10:45:00.000Z'), // 15 min AFTER NOW
        leftAt: null,
        minutesAttended: 5,
      });

      await service.markStudentLeft(SESSION, STUDENT);

      expect(mockPrisma.attendance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { leftAt: NOW, minutesAttended: 5 } }), // +0, not negative
      );
    });
  });

  describe('finalizeSessionAttendance', () => {
    it('closes open intervals at endTime, accumulating final minutes', async () => {
      mockPrisma.attendance.findMany.mockResolvedValue([
        { id: 'a1', joinedAt: new Date('2026-06-19T10:00:00.000Z'), minutesAttended: 0 },
      ]);
      const end = new Date('2026-06-19T10:40:00.000Z'); // 40 min after join

      const res = await service.finalizeSessionAttendance(SESSION, end);

      expect(mockPrisma.attendance.findMany).toHaveBeenCalledWith({
        where: { sessionId: SESSION, present: true, leftAt: null },
      });
      expect(mockPrisma.attendance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: { leftAt: end, minutesAttended: 40 },
        }),
      );
      expect(res).toEqual({ finalized: 1 });
    });

    it('is a no-op when there are no open intervals (already finalized)', async () => {
      mockPrisma.attendance.findMany.mockResolvedValue([]);

      const res = await service.finalizeSessionAttendance(SESSION);

      expect(mockPrisma.attendance.update).not.toHaveBeenCalled();
      expect(res).toEqual({ finalized: 0 });
    });
  });
});
