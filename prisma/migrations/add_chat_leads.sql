-- Public website chatbot lead capture.
-- Stores a lead submitted via the website chatbot lead form so a counsellor
-- can follow up. `email` is required; all other answer fields are optional.
-- `source_route` records the page the lead was captured on; `ip` is the
-- best-effort client IP (spoofable unless behind a trusted proxy);
-- `contacted` flags whether a counsellor has followed up yet.
--
-- Apply (DB tunnel on localhost:4015 must be up):
--   npx prisma db execute --file prisma/migrations/add_chat_leads.sql
-- then: npx prisma generate

CREATE TABLE IF NOT EXISTS "app"."chat_leads" (
  "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
  "name"         TEXT,
  "email"        TEXT           NOT NULL,
  "phone"        TEXT,
  "level"        TEXT,
  "curriculum"   TEXT,
  "region"       TEXT,
  "goal"         TEXT,
  "subject"      TEXT,
  "note"         TEXT,
  "source_route" TEXT,
  "ip"           TEXT,
  "contacted"    BOOLEAN        NOT NULL DEFAULT false,
  "created_at"   TIMESTAMPTZ(6)          DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_leads_created_at_idx"
  ON "app"."chat_leads" ("created_at");
