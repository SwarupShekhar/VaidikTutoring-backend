-- AlterTable
ALTER TABLE "app"."bookings" ADD COLUMN     "program_id" UUID;

-- AlterTable
ALTER TABLE "app"."purchases" ADD COLUMN     "program_id" UUID;

-- AlterTable
ALTER TABLE "app"."sessions" ADD COLUMN     "program_id" UUID;

-- AlterTable
ALTER TABLE "app"."students" ADD COLUMN     "program_id" UUID;

-- AlterTable
ALTER TABLE "app"."tutors" ADD COLUMN     "program_id" UUID;

-- AddForeignKey
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "app"."programs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."purchases" ADD CONSTRAINT "purchases_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "app"."programs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."sessions" ADD CONSTRAINT "sessions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "app"."programs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."students" ADD CONSTRAINT "students_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "app"."programs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."tutors" ADD CONSTRAINT "tutors_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "app"."programs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
