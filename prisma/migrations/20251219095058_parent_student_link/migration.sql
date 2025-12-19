-- AlterTable
ALTER TABLE "app"."users" ADD COLUMN     "parent_id" UUID;

-- AddForeignKey
ALTER TABLE "app"."users" ADD CONSTRAINT "users_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
