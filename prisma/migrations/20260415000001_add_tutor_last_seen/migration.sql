-- AddColumn: Add last_seen timestamp to tutors table
-- This field tracks when a tutor was last active (for online status checking)
-- Non-destructive: Existing data is preserved, new column is nullable
ALTER TABLE "app"."tutors" ADD COLUMN "last_seen" TIMESTAMP(3);
