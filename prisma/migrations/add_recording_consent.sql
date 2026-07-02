-- Parental recording consent for minors (COPPA / GDPR-K / India DPDP).
-- Captured once at parent onboarding (required) and toggleable from
-- Profile -> Settings. Sessions may run live without consent, but no
-- recording is produced or shared until it is granted.
--
-- Apply (DB tunnel on localhost:4015 must be up):
--   npx prisma db execute --file prisma/migrations/add_recording_consent.sql
-- then: npx prisma generate

ALTER TABLE "app"."students"
  ADD COLUMN IF NOT EXISTS "recording_consent_granted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "recording_consent_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "recording_consent_version" TEXT,
  ADD COLUMN IF NOT EXISTS "recording_consent_by" UUID;
