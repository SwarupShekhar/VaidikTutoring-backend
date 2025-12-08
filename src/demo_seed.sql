-- demo_seed.sql
SET search_path = app, public;

-- 1) curricula
INSERT INTO app.curricula (id, name, country, description)
VALUES
  (gen_random_uuid(), 'CCSS', 'USA', 'Common Core State Standards'),
  (gen_random_uuid(), 'NGSS', 'USA', 'Next Generation Science Standards')
ON CONFLICT DO NOTHING;

-- 2) subjects
INSERT INTO app.subjects (id, name, canonical_code, description)
VALUES
  (gen_random_uuid(), 'Mathematics', 'MATH', 'K-12 Mathematics'),
  (gen_random_uuid(), 'Physics', 'PHYS', 'K-12 Physics'),
  (gen_random_uuid(), 'Biology', 'BIO', 'K-12 Biology')
ON CONFLICT DO NOTHING;

-- 3) packages
INSERT INTO app.packages (id, name, description, price_cents, billing_type, active)
VALUES
  (gen_random_uuid(), '5 Hours Math', 'Five-hour 1:1 Math tutoring', 50000, 'one_time', true),
  (gen_random_uuid(), '10 Hours STEM', 'Ten-hour STEM bundle', 90000, 'one_time', true)
ON CONFLICT DO NOTHING;

-- 4) demo tutor user + tutor profile (in-house)
INSERT INTO app.users (id, email, password_hash, role, first_name, last_name)
VALUES
  (gen_random_uuid(), 'demo_tutor@example.com', 'PLACEHOLDER_HASH', 'tutor', 'Demo', 'Tutor')
ON CONFLICT DO NOTHING;

INSERT INTO app.tutors (id, user_id, bio, hourly_rate_cents, employment_type, is_active)
VALUES
  (gen_random_uuid(), (SELECT id FROM app.users WHERE email='demo_tutor@example.com'), 'Experienced STEM tutor (demo)', 3000, 'inhouse', true)
ON CONFLICT DO NOTHING;

-- 5) Create a demo booking for your existing student and assign tutor
-- Replace the student_id below if needed; I used the one you reported: 7ea2ee6d-...
WITH s AS (
  SELECT id AS student_id FROM app.students WHERE id = '7ea2ee6d-28a5-4a97-94d9-b075471ba9ea'
),
sel AS (
  SELECT
    (SELECT id FROM app.packages LIMIT 1) AS package_id,
    (SELECT id FROM app.subjects WHERE canonical_code='MATH' LIMIT 1) AS subject_id,
    (SELECT id FROM app.curricula LIMIT 1) AS curriculum_id,
    (SELECT id FROM app.tutors LIMIT 1) AS tutor_id
)
INSERT INTO app.bookings (id, student_id, package_id, subject_id, curriculum_id, requested_start, requested_end, status, assigned_tutor_id, created_at)
SELECT gen_random_uuid(), s.student_id, sel.package_id, sel.subject_id, sel.curriculum_id,
       now() + interval '2 days', now() + interval '2 days' + interval '1 hour',
       'confirmed', sel.tutor_id, now()
FROM s, sel
RETURNING id AS booking_id;

-- 6) Create a corresponding session (linked to booking) with placeholder links
WITH b AS (
  SELECT id FROM app.bookings ORDER BY created_at DESC LIMIT 1
)
INSERT INTO app.sessions (id, booking_id, start_time, end_time, meet_link, whiteboard_link, status, created_at)
SELECT gen_random_uuid(), b.id, now() + interval '2 days', now() + interval '2 days' + interval '1 hour',
       'https://meet.google.com/demo-placeholder', 'https://whiteboard.example/demo', 'scheduled', now()
FROM b
RETURNING id AS session_id;