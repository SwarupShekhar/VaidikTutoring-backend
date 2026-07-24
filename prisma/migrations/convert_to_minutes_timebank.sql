-- StudyHours: Convert credit balances from SESSION counts to a MINUTES time-bank
-- Run these IN ORDER against your PostgreSQL database, BEFORE deploying the new backend code.
-- Safe to re-run: every step is guarded (IF NOT EXISTS / one-shot marker), so a double-run is a no-op.
-- Wrapped in a transaction — if anything fails, nothing is applied.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 1 — Add the sessions.duration column (schema.prisma:340 adds it to the
-- Prisma model; without this column every `sessions` query throws
-- "column duration does not exist" and the whole sessions module dies).
-- Additive, nullable, default 45. Zero risk.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE app.sessions
  ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 45;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 2 — One-shot guard column so the balance backfill (STEP 3) can never
-- run twice on the same row (×45 is NOT idempotent — a double-run corrupts).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE app.students
  ADD COLUMN IF NOT EXISTS credits_migrated_to_minutes BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 3 — Convert existing balances to minutes. Guarded by STEP 2's marker.
--   * subscription_credits: paid balance was a SESSION count (8/16/24) -> ×45
--     gives 360/720/1080 min, matching the new grant map.
--   * trial_credits: set to a flat 120 min (one free 60-min + two 30-min).
--     The real trial gate is trial_sessions_used < 3, so the exact minute
--     figure only needs to clear the first 60-min check — 120 does, with margin.
--     Matches initTrialCredits() in credits.service.ts.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE app.students
SET
  subscription_credits        = subscription_credits * 45,
  trial_credits               = 120,
  credits_migrated_to_minutes = true
WHERE credits_migrated_to_minutes = false;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 4 — Align the column default with the code (schema.prisma:389 currently
-- says @default(450); code seeds 120). New rows created without an explicit
-- value should match. ALSO update schema.prisma:389 to @default(120) so Prisma
-- does not report drift on the next `prisma generate`/migrate.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE app.students
  ALTER COLUMN trial_credits SET DEFAULT 120;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY (run after commit — should show every row migrated, no session-scale
-- leftovers). Expect subscription_credits in {0,360,720,1080}, trial in {120,...}.
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT credits_migrated_to_minutes, count(*),
--        min(subscription_credits), max(subscription_credits),
--        min(trial_credits), max(trial_credits)
-- FROM app.students
-- GROUP BY 1;

-- ROLLBACK NOTE: this migration is not auto-reversible (×45 loses the original
-- session counts once the marker is set). If you must undo, restore from backup.
-- Take a snapshot of app.students before running in production.
