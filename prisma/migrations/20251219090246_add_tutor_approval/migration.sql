-- AlterTable
ALTER TABLE "app"."tutors" ADD COLUMN     "tutor_approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tutor_review_notes" TEXT;
