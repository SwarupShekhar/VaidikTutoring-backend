import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

import { SentryFilter } from './common/filters/sentry.filter.js';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

async function bootstrap() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      nodeProfilingIntegration(),
    ],
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
      'https://k-12-backend-vnp4.vercel.app',  // <-- ADD YOUR VERCEL DOMAIN HERE
      'https://k-12-vaidik.vercel.app',       // <--- ADD THIS ONE!
      'https://k-12-backend.onrender.com'
    ],
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  app.useGlobalFilters(new HttpExceptionFilter());
  // We need HttpAdapter for BaseExceptionFilter if we wanted to be strict, but SentryFilter implementation uses super.catch which might need it? 
  // BaseExceptionFilter usually needs httpAdapter if instantiated manually?
  // Let's just instantiate it. If it needs arguments, we should provide.
  // The BaseExceptionFilter can typically be instantiated empty or with HttpAdapterHost.
  // Let's try simple instantiation first.
  const { HttpAdapterHost } = await import('@nestjs/core');
  app.useGlobalFilters(new SentryFilter(app.get(HttpAdapterHost)));
  // We need to dynamically import or just use require if needed, but standard import should work if we add it to top.
  // Actually, let's just add the import at the top first, then use it here.
  // Wait, I can't add import at top in this same chunk if I'm targeting this block.
  // Let's assume I'll add import in another step or just use a require if lazy.
  // Better: separate steps. This step only adds the useGlobalFilters.
  // But wait, I need SentryFilter class available.

  // Let's do imports first in a separate call if possible, or just replace the whole file? No, replacing whole file is bad.
  // I will replace the filters block.


  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}
bootstrap();
