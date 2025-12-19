-- CreateEnum
CREATE TYPE "app"."TutorStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "app"."users" ADD COLUMN     "tutor_status" "app"."TutorStatus" NOT NULL DEFAULT 'ACTIVE';
