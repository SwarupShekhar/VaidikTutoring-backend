-- Public website chatbot transcript log.
-- Stores each visitor interaction for abuse auditing and analytics.
-- No student PII: the public bot never fetches or receives account data.
-- `ip` is the best-effort client IP (spoofable unless behind a trusted proxy);
-- `flagged` marks messages caught by moderation.
--
-- Apply (DB tunnel on localhost:4015 must be up):
--   npx prisma db execute --file prisma/migrations/add_chat_transcripts.sql
-- then: npx prisma generate

CREATE TABLE IF NOT EXISTS "app"."chat_transcripts" (
  "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
  "ip"           TEXT,
  "user_message" TEXT           NOT NULL,
  "bot_response" TEXT           NOT NULL,
  "flagged"      BOOLEAN        NOT NULL DEFAULT false,
  "created_at"   TIMESTAMPTZ(6)          DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_transcripts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_transcripts_created_at_idx"
  ON "app"."chat_transcripts" ("created_at");
