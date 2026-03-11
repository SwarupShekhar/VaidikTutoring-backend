-- Migration: fix_packages_pk
-- Description: Fix packages table primary key type from text to UUID
-- Created: 2026-03-11

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
ALTER TABLE "app"."bookings" DROP CONSTRAINT "bookings_package_id_fkey";
ALTER TABLE "app"."package_items" DROP CONSTRAINT "package_items_package_id_fkey";
ALTER TABLE "app"."purchases" DROP CONSTRAINT "purchases_package_id_fkey";
ALTER TABLE "app"."user_credits" DROP CONSTRAINT "user_credits_package_id_fkey";

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
