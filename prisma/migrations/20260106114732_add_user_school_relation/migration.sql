-- AlterTable
ALTER TABLE "app"."users" ADD COLUMN     "school_id" UUID;

-- AddForeignKey
ALTER TABLE "app"."users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "app"."schools"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
