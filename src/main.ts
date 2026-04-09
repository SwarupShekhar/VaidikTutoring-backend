// IMPORTANT: instrument.ts must be imported first before anything else
import './instrument.js';

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { SentryFilter } from './common/filters/sentry.filter.js';
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
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set. Refusing to start.');
  }

  const app = await NestFactory.create(AppModule);

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

  const port = process.env.PORT ?? 3000;
  
  // Enable graceful shutdown for Prisma / Render
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Application is running on: http://0.0.0.0:${port}`);
}
bootstrap();
