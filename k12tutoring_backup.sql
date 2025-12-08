--
-- PostgreSQL database dump
--

\restrict UqzZbLIX5xPwvgcdtoIYp6BYwRIzDdkfVmlEnSv51RF9xRrqhj7XMHOnOp0123a

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA app;


ALTER SCHEMA app OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assessment_attempts; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.assessment_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assessment_id uuid,
    student_id uuid,
    score numeric,
    answers jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE app.assessment_attempts OWNER TO postgres;

--
-- Name: assessments; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    subject_id uuid,
    curriculum_id uuid,
    metadata jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE app.assessments OWNER TO postgres;

--
-- Name: audit_logs; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action text,
    object_type text,
    object_id text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE app.audit_logs OWNER TO postgres;

--
-- Name: bookings; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    package_id uuid,
    subject_id uuid,
    curriculum_id uuid,
    requested_start timestamp with time zone,
    requested_end timestamp with time zone,
    status text,
    assigned_tutor_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'confirmed'::text, 'cancelled'::text, 'completed'::text])))
);


ALTER TABLE app.bookings OWNER TO postgres;

--
-- Name: curricula; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.curricula (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    country text,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE app.curricula OWNER TO postgres;

--
-- Name: curriculum_subject_map; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.curriculum_subject_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    curriculum_id uuid,
    subject_id uuid,
    external_code text
);


ALTER TABLE app.curriculum_subject_map OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    type text,
    payload jsonb,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE app.notifications OWNER TO postgres;

--
-- Name: package_items; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.package_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_id uuid,
    subject_id uuid,
    hours integer,
    note text
);


ALTER TABLE app.package_items OWNER TO postgres;

--
-- Name: packages; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    price_cents integer,
    currency text DEFAULT 'USD'::text,
    billing_type text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT packages_billing_type_check CHECK ((billing_type = ANY (ARRAY['subscription'::text, 'one_time'::text, 'block'::text])))
);


ALTER TABLE app.packages OWNER TO postgres;

--
-- Name: progress_points; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.progress_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    curriculum_id uuid,
    objective_code text,
    mastery_level text,
    last_updated timestamp with time zone DEFAULT now(),
    CONSTRAINT progress_points_mastery_level_check CHECK ((mastery_level = ANY (ARRAY['unknown'::text, 'learning'::text, 'proficient'::text, 'mastered'::text])))
);


ALTER TABLE app.progress_points OWNER TO postgres;

--
-- Name: purchases; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    package_id uuid,
    amount_cents integer,
    currency text,
    status text,
    payment_provider text,
    payment_provider_id text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT purchases_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text, 'cancelled'::text])))
);


ALTER TABLE app.purchases OWNER TO postgres;

--
-- Name: session_recordings; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.session_recordings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    storage_path text,
    duration_seconds integer,
    transcript text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE app.session_recordings OWNER TO postgres;

--
-- Name: sessions; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    meet_link text,
    whiteboard_link text,
    status text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'finished'::text, 'cancelled'::text])))
);


ALTER TABLE app.sessions OWNER TO postgres;

--
-- Name: students; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    parent_user_id uuid,
    grade text,
    school text,
    birth_date date,
    curriculum_preference uuid,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE app.students OWNER TO postgres;

--
-- Name: subjects; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    canonical_code text,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE app.subjects OWNER TO postgres;

--
-- Name: tutor_shifts; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.tutor_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_id uuid,
    day_of_week smallint,
    start_time time without time zone,
    end_time time without time zone,
    timezone text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tutor_shifts_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


ALTER TABLE app.tutor_shifts OWNER TO postgres;

--
-- Name: tutors; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.tutors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    bio text,
    qualifications jsonb,
    skills jsonb,
    hourly_rate_cents integer,
    employment_type text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tutors_employment_type_check CHECK ((employment_type = ANY (ARRAY['employee'::text, 'contractor'::text])))
);


ALTER TABLE app.tutors OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: app; Owner: postgres
--

CREATE TABLE app.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text,
    role text NOT NULL,
    first_name text,
    last_name text,
    phone text,
    timezone text DEFAULT 'UTC'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['parent'::text, 'student'::text, 'tutor'::text, 'admin'::text])))
);


ALTER TABLE app.users OWNER TO postgres;

--
-- Data for Name: assessment_attempts; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.assessment_attempts (id, assessment_id, student_id, score, answers, created_at) FROM stdin;
\.


--
-- Data for Name: assessments; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.assessments (id, title, subject_id, curriculum_id, metadata, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.audit_logs (id, actor_user_id, action, object_type, object_id, details, created_at) FROM stdin;
\.


--
-- Data for Name: bookings; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.bookings (id, student_id, package_id, subject_id, curriculum_id, requested_start, requested_end, status, assigned_tutor_id, created_at) FROM stdin;
00000000-0000-0000-0000-000000000040	00000000-0000-0000-0000-000000000012	00000000-0000-0000-0000-000000000030	00000000-0000-0000-0000-000000000002	00000000-0000-0000-0000-000000000001	2025-12-05 17:20:48.474745+05:30	2025-12-05 18:20:48.474745+05:30	confirmed	00000000-0000-0000-0000-000000000021	2025-12-04 17:20:48.474745+05:30
\.


--
-- Data for Name: curricula; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.curricula (id, name, country, description, created_at) FROM stdin;
00000000-0000-0000-0000-000000000001	CCSS	USA	\N	2025-12-04 17:20:48.474745+05:30
\.


--
-- Data for Name: curriculum_subject_map; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.curriculum_subject_map (id, curriculum_id, subject_id, external_code) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.notifications (id, user_id, type, payload, is_read, created_at) FROM stdin;
\.


--
-- Data for Name: package_items; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.package_items (id, package_id, subject_id, hours, note) FROM stdin;
\.


--
-- Data for Name: packages; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.packages (id, name, description, price_cents, currency, billing_type, active, created_at) FROM stdin;
00000000-0000-0000-0000-000000000030	5 Hours Math	5-hour one-on-one math tutoring	50000	USD	one_time	t	2025-12-04 17:20:48.474745+05:30
\.


--
-- Data for Name: progress_points; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.progress_points (id, student_id, curriculum_id, objective_code, mastery_level, last_updated) FROM stdin;
\.


--
-- Data for Name: purchases; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.purchases (id, user_id, package_id, amount_cents, currency, status, payment_provider, payment_provider_id, created_at) FROM stdin;
\.


--
-- Data for Name: session_recordings; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.session_recordings (id, session_id, storage_path, duration_seconds, transcript, created_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.sessions (id, booking_id, start_time, end_time, meet_link, whiteboard_link, status, created_at) FROM stdin;
00000000-0000-0000-0000-000000000050	00000000-0000-0000-0000-000000000040	2025-12-05 17:20:48.474745+05:30	2025-12-05 18:20:48.474745+05:30	https://meet.google.com/test-session	https://whiteboard.example	scheduled	2025-12-04 17:20:48.474745+05:30
\.


--
-- Data for Name: students; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.students (id, user_id, parent_user_id, grade, school, birth_date, curriculum_preference, created_at) FROM stdin;
00000000-0000-0000-0000-000000000012	00000000-0000-0000-0000-000000000011	00000000-0000-0000-0000-000000000010	8	Central School	\N	00000000-0000-0000-0000-000000000001	2025-12-04 17:20:48.474745+05:30
\.


--
-- Data for Name: subjects; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.subjects (id, name, canonical_code, description, created_at) FROM stdin;
00000000-0000-0000-0000-000000000002	Mathematics	MATH	\N	2025-12-04 17:20:48.474745+05:30
\.


--
-- Data for Name: tutor_shifts; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.tutor_shifts (id, tutor_id, day_of_week, start_time, end_time, timezone, created_at) FROM stdin;
\.


--
-- Data for Name: tutors; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.tutors (id, user_id, bio, qualifications, skills, hourly_rate_cents, employment_type, is_active, created_at) FROM stdin;
00000000-0000-0000-0000-000000000021	00000000-0000-0000-0000-000000000020	Experienced Math Tutor	\N	\N	3000	contractor	t	2025-12-04 17:20:48.474745+05:30
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: app; Owner: postgres
--

COPY app.users (id, email, password_hash, role, first_name, last_name, phone, timezone, is_active, created_at) FROM stdin;
00000000-0000-0000-0000-000000000010	parent@example.com	pw	parent	John	Parent	\N	UTC	t	2025-12-04 17:20:48.474745+05:30
00000000-0000-0000-0000-000000000011	student@example.com	pw	student	Alice	Student	\N	UTC	t	2025-12-04 17:20:48.474745+05:30
00000000-0000-0000-0000-000000000020	tutor@example.com	pw	tutor	David	Tutor	\N	UTC	t	2025-12-04 17:20:48.474745+05:30
\.


--
-- Name: assessment_attempts assessment_attempts_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.assessment_attempts
    ADD CONSTRAINT assessment_attempts_pkey PRIMARY KEY (id);


--
-- Name: assessments assessments_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: curricula curricula_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.curricula
    ADD CONSTRAINT curricula_pkey PRIMARY KEY (id);


--
-- Name: curriculum_subject_map curriculum_subject_map_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.curriculum_subject_map
    ADD CONSTRAINT curriculum_subject_map_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: package_items package_items_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.package_items
    ADD CONSTRAINT package_items_pkey PRIMARY KEY (id);


--
-- Name: packages packages_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.packages
    ADD CONSTRAINT packages_pkey PRIMARY KEY (id);


--
-- Name: progress_points progress_points_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.progress_points
    ADD CONSTRAINT progress_points_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: session_recordings session_recordings_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.session_recordings
    ADD CONSTRAINT session_recordings_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: subjects subjects_canonical_code_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.subjects
    ADD CONSTRAINT subjects_canonical_code_key UNIQUE (canonical_code);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: tutor_shifts tutor_shifts_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.tutor_shifts
    ADD CONSTRAINT tutor_shifts_pkey PRIMARY KEY (id);


--
-- Name: tutors tutors_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.tutors
    ADD CONSTRAINT tutors_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: assessment_attempts assessment_attempts_assessment_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.assessment_attempts
    ADD CONSTRAINT assessment_attempts_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES app.assessments(id);


--
-- Name: assessment_attempts assessment_attempts_student_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.assessment_attempts
    ADD CONSTRAINT assessment_attempts_student_id_fkey FOREIGN KEY (student_id) REFERENCES app.students(id);


--
-- Name: assessments assessments_created_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.users(id);


--
-- Name: assessments assessments_curriculum_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_curriculum_id_fkey FOREIGN KEY (curriculum_id) REFERENCES app.curricula(id);


--
-- Name: assessments assessments_subject_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.assessments
    ADD CONSTRAINT assessments_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES app.subjects(id);


--
-- Name: audit_logs audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES app.users(id);


--
-- Name: bookings bookings_assigned_tutor_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.bookings
    ADD CONSTRAINT bookings_assigned_tutor_id_fkey FOREIGN KEY (assigned_tutor_id) REFERENCES app.tutors(id);


--
-- Name: bookings bookings_curriculum_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.bookings
    ADD CONSTRAINT bookings_curriculum_id_fkey FOREIGN KEY (curriculum_id) REFERENCES app.curricula(id);


--
-- Name: bookings bookings_package_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.bookings
    ADD CONSTRAINT bookings_package_id_fkey FOREIGN KEY (package_id) REFERENCES app.packages(id);


--
-- Name: bookings bookings_student_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.bookings
    ADD CONSTRAINT bookings_student_id_fkey FOREIGN KEY (student_id) REFERENCES app.students(id);


--
-- Name: bookings bookings_subject_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.bookings
    ADD CONSTRAINT bookings_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES app.subjects(id);


--
-- Name: curriculum_subject_map curriculum_subject_map_curriculum_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.curriculum_subject_map
    ADD CONSTRAINT curriculum_subject_map_curriculum_id_fkey FOREIGN KEY (curriculum_id) REFERENCES app.curricula(id);


--
-- Name: curriculum_subject_map curriculum_subject_map_subject_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.curriculum_subject_map
    ADD CONSTRAINT curriculum_subject_map_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES app.subjects(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id);


--
-- Name: package_items package_items_package_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.package_items
    ADD CONSTRAINT package_items_package_id_fkey FOREIGN KEY (package_id) REFERENCES app.packages(id) ON DELETE CASCADE;


--
-- Name: package_items package_items_subject_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.package_items
    ADD CONSTRAINT package_items_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES app.subjects(id);


--
-- Name: progress_points progress_points_curriculum_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.progress_points
    ADD CONSTRAINT progress_points_curriculum_id_fkey FOREIGN KEY (curriculum_id) REFERENCES app.curricula(id);


--
-- Name: progress_points progress_points_student_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.progress_points
    ADD CONSTRAINT progress_points_student_id_fkey FOREIGN KEY (student_id) REFERENCES app.students(id);


--
-- Name: purchases purchases_package_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.purchases
    ADD CONSTRAINT purchases_package_id_fkey FOREIGN KEY (package_id) REFERENCES app.packages(id);


--
-- Name: purchases purchases_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.purchases
    ADD CONSTRAINT purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id);


--
-- Name: session_recordings session_recordings_session_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.session_recordings
    ADD CONSTRAINT session_recordings_session_id_fkey FOREIGN KEY (session_id) REFERENCES app.sessions(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_booking_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.sessions
    ADD CONSTRAINT sessions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES app.bookings(id) ON DELETE CASCADE;


--
-- Name: students students_curriculum_preference_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.students
    ADD CONSTRAINT students_curriculum_preference_fkey FOREIGN KEY (curriculum_preference) REFERENCES app.curricula(id);


--
-- Name: students students_parent_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.students
    ADD CONSTRAINT students_parent_user_id_fkey FOREIGN KEY (parent_user_id) REFERENCES app.users(id);


--
-- Name: students students_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.students
    ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: tutor_shifts tutor_shifts_tutor_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.tutor_shifts
    ADD CONSTRAINT tutor_shifts_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES app.tutors(id) ON DELETE CASCADE;


--
-- Name: tutors tutors_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: postgres
--

ALTER TABLE ONLY app.tutors
    ADD CONSTRAINT tutors_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict UqzZbLIX5xPwvgcdtoIYp6BYwRIzDdkfVmlEnSv51RF9xRrqhj7XMHOnOp0123a

