-- Paid-student reschedule requests (admin-actioned queue).
CREATE TABLE IF NOT EXISTS "app"."reschedule_requests" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"      UUID,
  "student_id"      UUID,
  "requested_by"    UUID,
  "student_name"    TEXT,
  "subject"         TEXT,
  "class_time"      TIMESTAMPTZ,
  "reason"          TEXT,
  "preferred_slots" TEXT,
  "status"          TEXT NOT NULL DEFAULT 'pending',
  "admin_note"      TEXT,
  "handled_by"      UUID,
  "handled_at"      TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "reschedule_requests_student_id_idx" ON "app"."reschedule_requests" ("student_id");
CREATE INDEX IF NOT EXISTS "reschedule_requests_status_idx" ON "app"."reschedule_requests" ("status");
