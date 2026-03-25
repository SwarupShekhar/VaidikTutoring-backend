-- StudyHours Trial Credits System - Database Migration
-- Run these in order against your PostgreSQL database

-- 1a. Add credit fields to the students table
ALTER TABLE app.students
  ADD COLUMN IF NOT EXISTS trial_credits        INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS trial_started_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_sessions_used  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_trial_active      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS subscription_plan    VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_credits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_starts  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_ends    TIMESTAMPTZ;

-- 1b. Add credit_cost and is_trial_session fields to the bookings table
ALTER TABLE app.bookings
  ADD COLUMN IF NOT EXISTS credit_cost       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_trial_session  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_free_session   BOOLEAN NOT NULL DEFAULT false;

-- 1c. Create credit_adjustments table for admin override audit trail
CREATE TABLE IF NOT EXISTS app.credit_adjustments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES app.students(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  note       TEXT,
  granted_by UUID REFERENCES app.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1d. Initialize trial for existing students who don't have trial data yet
UPDATE app.students
SET
  trial_credits = 10,
  trial_started_at = NOW(),
  trial_expires_at = NOW() + INTERVAL '7 days',
  trial_sessions_used = 0,
  is_trial_active = true
WHERE trial_started_at IS NULL;
