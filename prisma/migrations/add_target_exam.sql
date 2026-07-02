-- Adds the student's chosen target exam (id/slug from the curated exam list).
-- The exam DATE is stored in the existing students.exam_date column.
ALTER TABLE app.students ADD COLUMN IF NOT EXISTS target_exam TEXT;
