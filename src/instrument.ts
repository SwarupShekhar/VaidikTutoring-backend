import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN || 'https://9ded6c1a2074cfbe91999a0b86c8bc8f@o4511188712488960.ingest.us.sentry.io/4511188737064960',
  integrations: [nodeProfilingIntegration() as any],
  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,
  sendDefaultPii: true,
});
