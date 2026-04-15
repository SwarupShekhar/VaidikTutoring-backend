-- AddColumn: Add fallback_broadcasted_at to bookings table
-- This field tracks when the 15-minute fallback notification was last broadcast
-- Used to prevent repeated notifications to the same booking
ALTER TABLE "app"."bookings" ADD COLUMN "fallback_broadcasted_at" TIMESTAMP(3);
