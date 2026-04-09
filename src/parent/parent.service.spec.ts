import { Test, TestingModule } from '@nestjs/testing';
import { ParentService } from './parent.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = { users: { create: jest.fn() }, students: { findMany: jest.fn() } };

describe('ParentService', () => {
  let service: ParentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ParentService>(ParentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
