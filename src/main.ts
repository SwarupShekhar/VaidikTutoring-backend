// IMPORTANT: instrument.ts must be imported first before anything else
import './instrument';

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SentryFilter } from './common/filters/sentry.filter';
import helmet from 'helmet';
import compression from 'compression';

// Custom Socket adapter to increase max payload size for drawings with images
class ExtendedIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, {
      ...options,
      maxHttpBufferSize: 1e8, // 100MB limit for binary whiteboard data
    });
    return server;
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  logger.log('Starting application...');

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

  // Use Custom Socket.IO adapter for high-bandwidth whiteboard sync
  app.useWebSocketAdapter(new ExtendedIoAdapter(app));

  // Default body limit (restrict DOS attacks)
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ limit: '2mb', extended: true }));

  // Response Compression
  app.use(compression());

  // ✅ Enable CORS so frontend (Next.js) can call backend
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'https://studyhours.com',
      'https://www.studyhours.com',
      'https://k-12-backend-vnp4.vercel.app',
      'https://k-12-vaidik.vercel.app',
      'https://vaidiktutoring.vercel.app',
      'https://k-12-backend.onrender.com',
    ];

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

  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: ${await app.getUrl()}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}
bootstrap().catch(err => {
  console.error('Unhandled bootstrap error:', err);
  process.exit(1);
});
