-- Migration: fix_packages_pk
-- Description: Fix packages table primary key type from text to UUID
-- Created: 2026-03-11

-- RECOVERY: Missing Tables and Enums
DO $$ BEGIN CREATE TYPE "app"."TutorStatus" AS ENUM ('ACTIVE', 'SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "app"."AttentionEventType" AS ENUM ('CHECK_IN', 'EXPLANATION', 'RESPONSE', 'CORRECTION', 'PRAISE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "app"."SessionPhase" AS ENUM ('WARM_CONNECT', 'DIAGNOSE', 'MICRO_TEACH', 'ACTIVE_RESPONSE', 'REINFORCE', 'REFLECT'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "app"."webhook_events" ( "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "event_id" TEXT UNIQUE NOT NULL, "event_type" TEXT NOT NULL, "payload" JSONB NOT NULL, "processed" BOOLEAN NOT NULL DEFAULT false, "processed_at" TIMESTAMPTZ(6), "error" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE IF NOT EXISTS "app"."user_credits" ( "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "package_id" TEXT, "credits_total" INTEGER DEFAULT 0, "credits_used" INTEGER DEFAULT 0, "credits_remaining" INTEGER DEFAULT 0, "reset_date" TIMESTAMPTZ(6) NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL );
CREATE TABLE IF NOT EXISTS "app"."credit_usage_logs" ( "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "session_id" UUID, "credits_used" INTEGER DEFAULT 1, "used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "notes" TEXT );
CREATE TABLE IF NOT EXISTS "app"."credit_adjustments" ( "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "student_id" UUID NOT NULL, "amount" INTEGER NOT NULL, "note" TEXT, "granted_by" UUID, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE IF NOT EXISTS "app"."blog_versions" ( "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "blog_id" UUID NOT NULL, "title" TEXT NOT NULL, "excerpt" TEXT NOT NULL, "content" TEXT NOT NULL, "image_url" TEXT NOT NULL, "category" TEXT NOT NULL, "image_alt" TEXT, "summary" TEXT, "author_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE IF NOT EXISTS "app"."sticker_rewards" ( "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "session_id" UUID NOT NULL, "student_id" UUID NOT NULL, "sticker" TEXT NOT NULL, "given_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE IF NOT EXISTS "app"."attention_events" ( "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "session_id" UUID NOT NULL, "student_id" UUID NOT NULL, "tutor_id" UUID NOT NULL, "type" "app"."AttentionEventType" NOT NULL, "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "metadata" JSONB );
CREATE TABLE IF NOT EXISTS "app"."enrollments" ( "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "student_id" UUID NOT NULL, "program_id" UUID NOT NULL, "tutor_id" UUID, "schedule_preset" TEXT NOT NULL, "schedule_days" INTEGER[], "start_time" TEXT NOT NULL, "duration" INTEGER DEFAULT 60, "subject_ids" TEXT[], "curriculum_id" TEXT, "package_id" TEXT, "status" TEXT NOT NULL, "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ended_at" TIMESTAMPTZ(6), "pause_until" TIMESTAMPTZ(6), "schedule_source" TEXT DEFAULT 'auto', "auto_assign" BOOLEAN DEFAULT true, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP );

ALTER TABLE "app"."students" ADD COLUMN IF NOT EXISTS "email" TEXT, ADD COLUMN IF NOT EXISTS "interests" JSONB, ADD COLUMN IF NOT EXISTS "recent_focus" TEXT, ADD COLUMN IF NOT EXISTS "struggle_areas" JSONB, ADD COLUMN IF NOT EXISTS "trial_credits" INTEGER DEFAULT 10, ADD COLUMN IF NOT EXISTS "trial_started_at" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "trial_expires_at" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "trial_sessions_used" INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS "is_trial_active" BOOLEAN DEFAULT true, ADD COLUMN IF NOT EXISTS "subscription_plan" VARCHAR(20), ADD COLUMN IF NOT EXISTS "subscription_credits" INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS "subscription_starts" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "subscription_ends" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "enrollment_status" TEXT DEFAULT 'trial', ADD COLUMN IF NOT EXISTS "package_end_date" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "sessions_remaining" INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS "streak_weeks" INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS "last_session_week" TEXT, ADD COLUMN IF NOT EXISTS "badges" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN IF NOT EXISTS "total_hours_learned" DOUBLE PRECISION DEFAULT 0, ADD COLUMN IF NOT EXISTS "trial_tutor_id" UUID;
ALTER TABLE "app"."sessions" ADD COLUMN IF NOT EXISTS "attention_status" TEXT, ADD COLUMN IF NOT EXISTS "attention_meta" JSONB, ADD COLUMN IF NOT EXISTS "current_phase" "app"."SessionPhase" DEFAULT 'WARM_CONNECT', ADD COLUMN IF NOT EXISTS "phase_history" JSONB, ADD COLUMN IF NOT EXISTS "pedagogy_status" TEXT, ADD COLUMN IF NOT EXISTS "tutor_note" TEXT, ADD COLUMN IF NOT EXISTS "whiteboard_snapshot_url" TEXT;
ALTER TABLE "app"."session_recordings" ADD COLUMN IF NOT EXISTS "azure_blob_name" TEXT, ADD COLUMN IF NOT EXISTS "mime_type" TEXT, ADD COLUMN IF NOT EXISTS "last_viewed_at" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "view_count" INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS "auto_delete_at" TIMESTAMPTZ(6);
ALTER TABLE "app"."bookings" ADD COLUMN IF NOT EXISTS "credit_cost" INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS "is_trial_session" BOOLEAN DEFAULT false, ADD COLUMN IF NOT EXISTS "is_free_session" BOOLEAN DEFAULT false, ADD COLUMN IF NOT EXISTS "enrollment_id" UUID;
ALTER TABLE "app"."purchases" ADD COLUMN IF NOT EXISTS "razorpay_order_id" TEXT, ADD COLUMN IF NOT EXISTS "razorpay_payment_id" TEXT, ADD COLUMN IF NOT EXISTS "razorpay_signature" TEXT, ADD COLUMN IF NOT EXISTS "payment_method" TEXT, ADD COLUMN IF NOT EXISTS "payment_method_detail" JSONB, ADD COLUMN IF NOT EXISTS "failure_reason" TEXT, ADD COLUMN IF NOT EXISTS "refund_id" TEXT, ADD COLUMN IF NOT EXISTS "refunded_at" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "ip_address" TEXT, ADD COLUMN IF NOT EXISTS "user_agent" TEXT;
ALTER TABLE "app"."users" ADD COLUMN IF NOT EXISTS "parent_id" UUID, ADD COLUMN IF NOT EXISTS "tutor_invite_token" TEXT, ADD COLUMN IF NOT EXISTS "tutor_invite_expires" TIMESTAMPTZ(6), ADD COLUMN IF NOT EXISTS "tutor_status" "app"."TutorStatus" DEFAULT 'ACTIVE';

-- Step 1: Create new UUID column
ALTER TABLE "app"."packages" ADD COLUMN "new_id" UUID DEFAULT gen_random_uuid();

-- Step 2: Update new_id with existing IDs converted to UUIDs
UPDATE "app"."packages" SET "new_id" = gen_random_uuid() WHERE "new_id" IS NULL;

-- Step 3: Update foreign key references in dependent tables
UPDATE "app"."bookings" SET "package_id" = (SELECT "new_id" FROM "app"."packages" WHERE "id" = "bookings"."package_id") WHERE "package_id" IS NOT NULL;
UPDATE "app"."package_items" SET "package_id" = (SELECT "new_id" FROM "app"."packages" WHERE "id" = "package_items"."package_id") WHERE "package_id" IS NOT NULL;
UPDATE "app"."purchases" SET "package_id" = (SELECT "new_id" FROM "app"."packages" WHERE "id" = "purchases"."package_id") WHERE "package_id" IS NOT NULL;
UPDATE "app"."user_credits" SET "package_id" = (SELECT "new_id" FROM "app"."packages" WHERE "id" = "user_credits"."package_id") WHERE "package_id" IS NOT NULL;

-- Step 4: Drop foreign key constraints
ALTER TABLE "app"."bookings" DROP CONSTRAINT IF EXISTS "bookings_package_id_fkey";
ALTER TABLE "app"."package_items" DROP CONSTRAINT IF EXISTS "package_items_package_id_fkey";
ALTER TABLE "app"."purchases" DROP CONSTRAINT IF EXISTS "purchases_package_id_fkey";
ALTER TABLE "app"."user_credits" DROP CONSTRAINT IF EXISTS "user_credits_package_id_fkey";

-- Step 5: Drop old primary key
ALTER TABLE "app"."packages" DROP CONSTRAINT "packages_pkey";

-- Step 6: Drop old ID column and rename new_id
ALTER TABLE "app"."packages" DROP COLUMN "id";
ALTER TABLE "app"."packages" RENAME COLUMN "new_id" TO "id";

-- Step 7: Add new primary key
ALTER TABLE "app"."packages" ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");

-- Step 8: Recreate foreign key constraints
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "app"."packages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "app"."package_items" ADD CONSTRAINT "package_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "app"."packages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "app"."purchases" ADD CONSTRAINT "purchases_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "app"."packages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "app"."user_credits" ADD CONSTRAINT "user_credits_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "app"."packages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

