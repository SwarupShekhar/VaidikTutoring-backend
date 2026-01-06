-- CreateTable
CREATE TABLE "app"."programs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "academic" JSONB NOT NULL,
    "operational" JSONB NOT NULL,
    "financial" JSONB NOT NULL,
    "staffing" JSONB NOT NULL,
    "delivery" JSONB NOT NULL,
    "reporting" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);
