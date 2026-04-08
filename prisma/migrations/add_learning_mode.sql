✅ Using DIRECT_URL for migrations
-- AlterTable
ALTER TABLE "app"."bookings" ADD COLUMN     "enrollment_id" UUID;

-- AlterTable
ALTER TABLE "app"."session_recordings" ADD COLUMN     "mime_type" TEXT;

-- AlterTable
ALTER TABLE "app"."students" ADD COLUMN     "trial_tutor_id" UUID;

-- CreateTable
CREATE TABLE "app"."enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "tutor_id" UUID,
    "schedule_preset" TEXT NOT NULL,
    "schedule_days" INTEGER[],
    "start_time" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 60,
    "subject_ids" TEXT[],
    "curriculum_id" TEXT,
    "package_id" TEXT,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "pause_until" TIMESTAMPTZ(6),
    "schedule_source" TEXT NOT NULL DEFAULT 'auto',
    "auto_assign" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "app"."enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."students" ADD CONSTRAINT "students_trial_tutor_id_fkey" FOREIGN KEY ("trial_tutor_id") REFERENCES "app"."tutors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."enrollments" ADD CONSTRAINT "enrollments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "app"."programs"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."enrollments" ADD CONSTRAINT "enrollments_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "app"."tutors"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

