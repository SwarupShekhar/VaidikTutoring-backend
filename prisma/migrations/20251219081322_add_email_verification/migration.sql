-- AlterTable
ALTER TABLE "app"."users" ADD COLUMN     "email_verification_expires" TIMESTAMPTZ(6),
ADD COLUMN     "email_verification_token" TEXT,
ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false;
