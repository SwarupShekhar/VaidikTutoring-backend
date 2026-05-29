-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_status_idx" ON "app"."bookings"("status");
CREATE INDEX IF NOT EXISTS "bookings_requested_start_idx" ON "app"."bookings"("requested_start");
CREATE INDEX IF NOT EXISTS "bookings_status_requested_start_idx" ON "app"."bookings"("status", "requested_start");
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_idx" ON "app"."notifications"("user_id", "is_read");
CREATE INDEX IF NOT EXISTS "purchases_status_idx" ON "app"."purchases"("status");
CREATE INDEX IF NOT EXISTS "sessions_status_idx" ON "app"."sessions"("status");
CREATE INDEX IF NOT EXISTS "sessions_start_time_idx" ON "app"."sessions"("start_time");
CREATE INDEX IF NOT EXISTS "sessions_status_start_time_idx" ON "app"."sessions"("status", "start_time");
CREATE INDEX IF NOT EXISTS "students_subscription_ends_idx" ON "app"."students"("subscription_ends");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "app"."users"("role");
CREATE INDEX IF NOT EXISTS "users_role_is_active_idx" ON "app"."users"("role", "is_active");
CREATE INDEX IF NOT EXISTS "blogs_status_published_at_idx" ON "app"."blogs"("status", "published_at");
CREATE INDEX IF NOT EXISTS "blogs_created_at_idx" ON "app"."blogs"("created_at");
