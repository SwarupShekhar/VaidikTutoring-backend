import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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

  // ✅ Enable CORS so frontend (Next.js) can call backend
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'https://k-12-backend-vnp4.vercel.app', // <-- ADD YOUR VERCEL DOMAIN HERE
      'https://k-12-vaidik.vercel.app', // <--- ADD THIS ONE!
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
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}
bootstrap();
