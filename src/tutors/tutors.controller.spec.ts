import { Test, TestingModule } from '@nestjs/testing';
import { TutorsController } from './tutors.controller';
import { TutorsService } from './tutors.service';
import { BookingsService } from '../bookings/bookings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

const mockTutorsService = { getTutorStats: jest.fn(), getTutorById: jest.fn() };
const mockBookingsService = { findByTutor: jest.fn() };

describe('TutorsController', () => {
  let controller: TutorsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TutorsController],
      providers: [
        { provide: TutorsService, useValue: mockTutorsService },
        { provide: BookingsService, useValue: mockBookingsService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TutorsController>(TutorsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
