import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

import { SentryFilter } from './common/filters/sentry.filter.js';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

async function bootstrap() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });

  const app = await NestFactory.create(AppModule);

  // Use Socket.IO adapter for WebSocket support with namespaces
  app.useWebSocketAdapter(new IoAdapter(app));

  // Increase body limit to 50mb for large blog posts
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // ✅ Enable CORS so frontend (Next.js) can call backend
  app.enableCors({
    origin: [
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
    ],
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

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
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Application is running on: http://0.0.0.0:${port}`);
}
bootstrap();
