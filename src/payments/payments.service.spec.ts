import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from '../credits/credits.service';
import { AdminAlertsService } from '../notifications/admin-alerts.service';
import { BadRequestException } from '@nestjs/common';

// Mock Razorpay
jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => {
    return {
      orders: {
        create: jest.fn(),
      },
      payments: {
        fetch: jest.fn(),
      },
    };
  });
});

const mockPrisma = {
  packages: { findUnique: jest.fn() },
  purchases: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  audit_logs: { create: jest.fn() },
  students: { findFirst: jest.fn() },
  webhook_events: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'RAZORPAY_KEY_ID') return 'test_key';
    if (key === 'RAZORPAY_KEY_SECRET') return 'test_secret';
    return null;
  }),
};

const mockCredits = { grantCredits: jest.fn() };
const mockAdminAlerts = { notifyPaymentFailure: jest.fn() };

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: CreditsService, useValue: mockCredits },
        { provide: AdminAlertsService, useValue: mockAdminAlerts },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOrder', () => {
    const userId = 'user-1';
    const packageId = 'pkg-1';
    const ip = '127.0.0.1';

    it('should throw BadRequestException if package not found', async () => {
      mockPrisma.packages.findUnique.mockResolvedValue(null);
      await expect(service.createOrder(userId, packageId, ip)).rejects.toThrow(BadRequestException);
    });

    it('should create order successfully', async () => {
      const mockPkg = { 
        id: packageId, 
        name: 'Test Pkg', 
        price_cents: 1000, 
        active: true,
        package_items: [{ hours: 5 }]
      };
      const mockPurchase = { id: 'purchase-1' };
      const mockRazorpayOrder = { id: 'order-1', amount: 1000, currency: 'USD' };

      mockPrisma.packages.findUnique.mockResolvedValue(mockPkg);
      mockPrisma.purchases.create.mockResolvedValue(mockPurchase);
      
      // Access the mock Razorpay instance
      const razorpayInstance = (service as any).razorpay;
      razorpayInstance.orders.create.mockResolvedValue(mockRazorpayOrder);

      const result = await service.createOrder(userId, packageId, ip);

      expect(result).toBeDefined();
      expect(result.orderId).toBe('order-1');
      expect(mockPrisma.purchases.create).toHaveBeenCalled();
      expect(mockPrisma.purchases.update).toHaveBeenCalledWith(expect.objectContaining({
          where: { id: mockPurchase.id },
          data: { razorpay_order_id: 'order-1' }
      }));
    });
  });

  describe('verifyPayment', () => {
    it('should throw if signature is invalid', async () => {
        await expect(service.verifyPayment('order-1', 'pay-1', 'invalid_sig'))
            .rejects.toThrow(BadRequestException);
    });
  });
});
