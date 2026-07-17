-- Referral attribution: which user invited this account via a peer referral link
-- (/signup?ref=<inviterId>). Distinct from parent_id (family ParentChildren relation).
-- Counted by the gated-resource unlock in CmsController.verifyReferralsAndUnlock.
-- Apply with: psql "$DATABASE_URL" -f prisma/migrations/add_referred_by.sql
-- (or `npx prisma migrate dev --name add_referred_by` when the DB is reachable)

ALTER TABLE "app"."users"
  ADD COLUMN IF NOT EXISTS "referred_by" UUID;

CREATE INDEX IF NOT EXISTS "users_referred_by_idx" ON "app"."users" ("referred_by");

-- Nullify attribution if the inviter is deleted (matches Prisma onDelete: SetNull).
ALTER TABLE "app"."users" DROP CONSTRAINT IF EXISTS "users_referred_by_fkey";
ALTER TABLE "app"."users"
  ADD CONSTRAINT "users_referred_by_fkey"
  FOREIGN KEY ("referred_by") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
