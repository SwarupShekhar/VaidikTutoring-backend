-- CreateTable
CREATE TABLE IF NOT EXISTS "app"."tutor_ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "tutor_id" UUID NOT NULL,
    "rated_by_user_id" UUID,
    "score" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tutor_ratings_session_id_key" ON "app"."tutor_ratings"("session_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tutor_ratings_tutor_id_idx" ON "app"."tutor_ratings"("tutor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tutor_ratings_rated_by_user_id_idx" ON "app"."tutor_ratings"("rated_by_user_id");

-- AddForeignKey
ALTER TABLE "app"."tutor_ratings" ADD CONSTRAINT "tutor_ratings_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "app"."sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."tutor_ratings" ADD CONSTRAINT "tutor_ratings_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "app"."tutors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app"."tutor_ratings" ADD CONSTRAINT "tutor_ratings_rated_by_user_id_fkey"
    FOREIGN KEY ("rated_by_user_id") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
