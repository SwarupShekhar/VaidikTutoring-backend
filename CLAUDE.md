# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev          # Start with hot reload
npm run start:debug        # Start with debugger

# Build
npm run build              # Generate Prisma client + compile TypeScript

# Production
npm run start:prod                 # Start compiled server
npm run start:migrate:prod         # Run migrations + seed + start (deployment)

# Database
npx prisma generate                # Regenerate Prisma client after schema changes
npx prisma migrate dev --name <name>  # Create and apply a new migration
npx prisma migrate deploy          # Apply pending migrations (production)
npx prisma studio                  # Open Prisma Studio GUI
npm run seed                       # Seed database (TS_NODE_TRANSPILE_ONLY=true)

# Tests
npm run test               # Run all unit tests
npm run test:watch         # Run tests in watch mode
npm run test:cov           # Run with coverage
npm run test:e2e           # Run end-to-end tests

# Linting/Formatting
npm run lint               # ESLint with auto-fix
npm run format             # Prettier format
```

## Architecture Overview

**NestJS modular monolith** for a K12 tutoring platform (Vaidik / studyhours.com). Each feature lives in its own module under `src/`.

### Key Architectural Patterns

- **Module structure:** Each feature module typically has `*.module.ts`, `*.controller.ts`, `*.service.ts`, and `dto/` or `schemas/` for validation.
- **Database:** Prisma ORM with PostgreSQL. The Prisma client is generated into `../generated/prisma` (not `node_modules`). `PrismaModule` is global — inject `PrismaService` anywhere without re-importing the module.
- **Authentication:** Dual-layer — JWT via Passport (`JwtAuthGuard`) for standard auth, and Clerk SDK (`ClerkAuthGuard`) for managed auth flows. Additional guards enforce email verification, tutor status, and parent-owns-student authorization.
- **WebSockets:** Socket.IO adapter configured at app level. `SessionsGateway` handles live tutoring sessions; `NotificationsGateway` handles real-time user notifications. Both use room-based messaging.
- **Real-time collaboration:** Yjs (CRDT) is used for whiteboard sync within live sessions.
- **Payments:** Razorpay integration in `PaymentsModule`. Raw body is preserved on `/payments` routes via `RawBodyMiddleware` — required for webhook signature verification.
- **Rate limiting:** ThrottlerModule applies globally (100 requests/minute per IP).
- **Error tracking:** Sentry with profiling, initialized in `main.ts`. `SentryFilter` and `HttpExceptionFilter` are registered globally.

### Core Module Groups

| Domain | Modules |
|--------|---------|
| Identity | `auth`, `students`, `tutors`, `parent`, `schools` |
| Scheduling | `bookings`, `sessions`, `session-phases` |
| Learning | `subjects`, `programs`, `catalog`, `attention-events` |
| Commerce | `payments`, `credits` |
| Communication | `email`, `notifications`, `invite` |
| Content | `blogs`, `media`, `storage` |
| Infrastructure | `prisma`, `admin`, `common` |

### Database Schema Notes

- Prisma schema uses a custom output path: `../generated/prisma` — run `npx prisma generate` after any `schema.prisma` change.
- Multi-schema with `"app"` as the default schema.
- Key enums: `TutorStatus` (ACTIVE/SUSPENDED), `SessionPhase` (WARM_CONNECT, DIAGNOSE, MICRO_TEACH, ACTIVE_RESPONSE, REINFORCE, REFLECT), `AttentionEventType` (CHECK_IN, EXPLANATION, RESPONSE, CORRECTION, PRAISE).

### Environment Variables

See `.env.template` for required variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET`, `JWT_EXPIRATION` — Token auth
- `FRONTEND_URL` — CORS origin
- `DAILY_API_KEY` — Daily.co video calls
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — Payments
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME` — Session recordings
