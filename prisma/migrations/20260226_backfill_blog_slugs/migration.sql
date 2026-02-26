-- Backfill missing slugs for existing blogs
-- Generate slug from title if slug is null or empty

UPDATE "app"."blogs"
SET slug = LOWER(
    TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                REGEXP_REPLACE(title, '[^\w\s-]', ''),
                '[\s_-]+', '-'
            ),
            '^-+|-+$', ''
        )
    )
)
WHERE slug IS NULL OR slug = '';

-- For any duplicate slugs, append the blog's id to make them unique
WITH duplicates AS (
    SELECT id, slug, ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at ASC) as rn
    FROM "app"."blogs"
)
UPDATE "app"."blogs"
SET slug = duplicates.slug || '-' || SUBSTRING(duplicates.id::text, 1, 8)
FROM duplicates
WHERE "app"."blogs".id = duplicates.id AND duplicates.rn > 1;
