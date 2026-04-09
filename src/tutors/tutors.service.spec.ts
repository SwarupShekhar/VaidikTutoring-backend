import { Test, TestingModule } from '@nestjs/testing';
import { TutorsService } from './tutors.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = { users: { findUnique: jest.fn(), create: jest.fn() } };

describe('TutorsService', () => {
  let service: TutorsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TutorsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TutorsService>(TutorsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
