import { Controller, Get, ServiceUnavailableException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      // Check database connection
      await this.prisma.$queryRaw`SELECT 1`;
      
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: 'healthy',
        },
      };
    } catch (error) {
      this.logger.error(`Database connection check failed: ${error.message}`);
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
        services: {
          database: 'unhealthy',
        },
        error: error.message,
      });
    }
  }

  @Get('trigger-error')
  triggerErrorTest() {
    this.logger.warn('⚠️ BetterStack Test Warning: High API load threshold exceeded on backend.');
    this.logger.error('❌ BetterStack Test Error: Simulated external payment gateway timeout failure.', 'RazorpayService.verifyPayment');
    this.logger.debug('🔍 BetterStack Test Debug: Verifying socket client heartbeat heartbeat handshake connection.');
    
    return {
      message: 'Simulated warning, error, and debug logs triggered and streamed to Better Stack successfully!',
      timestamp: new Date().toISOString(),
    };
  }
}
