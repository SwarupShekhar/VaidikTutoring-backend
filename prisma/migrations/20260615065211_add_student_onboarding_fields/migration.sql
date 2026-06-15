-- Add self-student onboarding fields captured during the rich 2-step onboarding flow.
ALTER TABLE "app"."students" ADD COLUMN "exam_board" TEXT;
ALTER TABLE "app"."students" ADD COLUMN "target_grade" TEXT;
ALTER TABLE "app"."students" ADD COLUMN "exam_date" DATE;

-- Track when the one-time onboarding nudge email was sent so the cron never double-sends.
ALTER TABLE "app"."users" ADD COLUMN "onboarding_nudged_at" TIMESTAMPTZ(6);
