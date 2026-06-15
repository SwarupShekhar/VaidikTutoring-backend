-- Behavioral onboarding email engine.

-- Per-user, per-type send log + MCQ answer store (idempotency via unique).
CREATE TABLE "app"."email_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "answer" TEXT,
    "answered_at" TIMESTAMPTZ(6),
    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_events_user_id_type_key" ON "app"."email_events" ("user_id", "type");
CREATE INDEX "email_events_user_id_idx" ON "app"."email_events" ("user_id");

-- Marketing/lifecycle email opt-out (transactional mail unaffected).
ALTER TABLE "app"."users" ADD COLUMN "email_opted_out" BOOLEAN NOT NULL DEFAULT false;

-- Superseded by the email_events('mcq_academic') row; remove the old single-nudge marker.
ALTER TABLE "app"."users" DROP COLUMN IF EXISTS "onboarding_nudged_at";
