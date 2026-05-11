// IMPORTANT: instrument.ts must be imported first before anything else
import './instrument';

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SentryFilter } from './common/filters/sentry.filter';
import helmet from 'helmet';
import compression from 'compression';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { BetterStackLogger } from './common/logger/betterstack.logger';

// Custom Socket adapter to increase max payload size for drawings with images
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

// Custom Socket adapter to increase max payload size for drawings with images and support clustering
class ExtendedIoAdapter extends IoAdapter {
  private adapterConstructor: any;

  async connectToRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log('[Socket.IO] No REDIS_URL found, Socket.IO running in local/single-process mode');
      return;
    }

    try {
      console.log('[Socket.IO] Connecting to Redis adapter...');
      const pubClient = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        family: 4, // Force IPv4 to align with cache manager settings
      });
      const subClient = pubClient.duplicate();

      pubClient.on('error', (err) => console.error('[Socket.IO Redis Pub Client Error]', err.message));
      subClient.on('error', (err) => console.error('[Socket.IO Redis Sub Client Error]', err.message));

      await Promise.all([
        new Promise<void>((resolve) => pubClient.once('ready', () => resolve())),
        new Promise<void>((resolve) => subClient.once('ready', () => resolve())),
      ]);

      this.adapterConstructor = createAdapter(pubClient, subClient);
      console.log('[Socket.IO] ✅ Redis adapter connected successfully!');
    } catch (err: any) {
      console.error('[Socket.IO] Redis adapter initialization failed:', err.message);
    }
  }

  createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, {
      ...options,
      maxHttpBufferSize: 1e8, // 100MB limit for binary whiteboard data
    });
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}

import dns from 'node:dns/promises';

/**
 * Pre-resolves database host to IPv4 to bypass dual-stack (IPv6) Happy Eyeballs
 * timeouts inside Docker bridged container networks. Uses Neon's SNI fallback routing.
 */
async function resolveDatabaseUrlIPv4(logger: Logger) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  if (databaseUrl.includes('neon.tech') && !databaseUrl.includes('options=endpoint')) {
    try {
      const parsedUrl = new URL(databaseUrl);
      const hostname = parsedUrl.hostname;
      
      // Resolve IPv4 addresses only
      const ips = await dns.resolve4(hostname);
      if (ips && ips.length > 0) {
        const ip = ips[0];
        const endpoint = hostname.split('.')[0];
        
        parsedUrl.hostname = ip;
        parsedUrl.searchParams.set('options', `endpoint=${endpoint}`);
        
        process.env.DATABASE_URL = parsedUrl.toString();
        // Disable strict TLS checks to allow connecting to raw IP with certificate hostname mismatch
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        
        logger.log(`[Database DNS] Resolved '${hostname}' to IPv4 '${ip}' successfully.`);
        logger.log(`[Database DNS] Set SNI parameter 'endpoint=${endpoint}' and disabled TLS hostname checks.`);
      }
    } catch (err: any) {
      logger.warn(`[Database DNS] IPv4 pre-resolution failed: ${err.message}. Falling back to default resolution.`);
    }
  }
}

async function bootstrap() {
  const betterStackLogger = new BetterStackLogger();
  const logger = new Logger('Bootstrap');
  logger.log('Starting application...');

  // Resolve DATABASE_URL to IPv4 to fix Docker bridged routing timeouts
  await resolveDatabaseUrlIPv4(logger);

  // Critical Environment Validation
  const requiredEnv = ['DATABASE_URL', 'CLERK_SECRET_KEY', 'JWT_SECRET'];
  const missing = requiredEnv.filter(k => !process.env[k]);
  if (missing.length > 0) {
    logger.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
    // On Render, we want to exit so the deployment fails visibly
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(betterStackLogger);

  // Use Custom Socket.IO adapter for high-bandwidth whiteboard sync and clustering
  const redisIoAdapter = new ExtendedIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Default body limit (restrict DOS attacks)
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ limit: '2mb', extended: true }));

  // Response Compression
  app.use(compression());

  // ✅ Enable CORS so frontend (Next.js) can call backend
  const isProduction = process.env.NODE_ENV === 'production';
  const productionOrigins = [
    'https://studyhours.com',
    'https://www.studyhours.com',
    'https://k-12-backend-vnp4.vercel.app',
    'https://k-12-vaidik.vercel.app',
    'https://vaidiktutoring.vercel.app',
    'https://api.studyhours.com',
  ];
  const developmentOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    ...productionOrigins,
  ];
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : isProduction ? productionOrigins : developmentOrigins;

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  // Security headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow Daily.co and other CDN resources
    contentSecurityPolicy: false, // CSP is handled by the frontend Next.js config
  }));

  // Global Exception Filters
  // Note: We access the httpAdapter directly to pass to BaseExceptionFilter
  const { HttpAdapterHost } = await import('@nestjs/core');
  const httpAdapter = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new HttpExceptionFilter(),
    new SentryFilter(httpAdapter.httpAdapter),
  );

  // Global Validation Pipe
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = process.env.PORT || 3001;
  logger.log(`Application binding to port ${port} on 0.0.0.0`);
  
  // Enable graceful shutdown for Prisma / Render
  app.enableShutdownHooks();

  // 📝 Setup Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('StudyHours API')
    .setDescription('The API documentation for StudyHours tutoring platform. Provides endpoints for session management, billing, and user profiles.')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('sessions', 'Session and Whiteboard operations')
    .addTag('auth', 'Authentication and Authorization')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: ${await app.getUrl()}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}
bootstrap().catch(err => {
  console.error('Unhandled bootstrap error:', err);
  process.exit(1);
});
