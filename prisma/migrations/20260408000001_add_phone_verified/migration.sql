-- AlterTable
ALTER TABLE "app"."users" ADD COLUMN IF NOT EXISTS "phone_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app"."users" ADD COLUMN IF NOT EXISTS "phone" TEXT;
