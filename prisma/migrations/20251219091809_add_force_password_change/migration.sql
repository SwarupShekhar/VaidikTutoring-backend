-- AlterTable
ALTER TABLE "app"."users" ADD COLUMN     "force_password_change" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tutor_invite_expires" TIMESTAMPTZ(6),
ADD COLUMN     "tutor_invite_token" TEXT;
