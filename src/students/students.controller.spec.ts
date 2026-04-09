import { Test, TestingModule } from '@nestjs/testing';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { CreditsService } from '../credits/credits.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

const mockStudentsService = { create: jest.fn(), findAll: jest.fn() };
const mockCreditsService = { getStatus: jest.fn() };

describe('StudentsController', () => {
  let controller: StudentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudentsController],
      providers: [
        { provide: StudentsService, useValue: mockStudentsService },
        { provide: CreditsService, useValue: mockCreditsService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StudentsController>(StudentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
