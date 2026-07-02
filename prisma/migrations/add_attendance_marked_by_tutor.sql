-- Honest attendance: distinguish a tutor's manual "present" mark from the
-- auto socket-join present flag. A tutor-marked row always counts as attended;
-- otherwise attendance requires >= 30 captured minutes.
-- Apply with: psql "$DATABASE_URL" -f prisma/migrations/add_attendance_marked_by_tutor.sql
-- (or `npx prisma migrate dev --name add_attendance_marked_by_tutor` when the DB is reachable)

ALTER TABLE "app"."attendance"
  ADD COLUMN IF NOT EXISTS "marked_by_tutor" BOOLEAN NOT NULL DEFAULT false;
