-- Regional Pricing Seed Data
-- Created: 2026-03-11
-- Description: Seed packages for US and UK regions with new credit-based pricing

-- US Packages (USD)
INSERT INTO app.packages (id, name, description, price_cents, currency, billing_type, active, created_at)
VALUES
  ('us-foundation-package-id', 'Foundation (US)', '2 sessions per week - 8 monthly credits', 19900, 'USD', 'subscription', true, NOW()),
  ('us-mastery-package-id', 'Mastery (US)', '4 sessions per week - 16 monthly credits', 34900, 'USD', 'subscription', true, NOW()),
  ('us-elite-package-id', 'Elite (US)', '6 sessions per week - 24 monthly credits', 49900, 'USD', 'subscription', true, NOW())
ON CONFLICT (id) DO NOTHING;

-- UK Packages (GBP)  
INSERT INTO app.packages (id, name, description, price_cents, currency, billing_type, active, created_at)
VALUES
  ('uk-foundation-package-id', 'Foundation (UK)', '2 sessions per week - 8 monthly credits', 14900, 'GBP', 'subscription', true, NOW()),
  ('uk-mastery-package-id', 'Mastery (UK)', '4 sessions per week - 16 monthly credits', 24900, 'GBP', 'subscription', true, NOW()),
  ('uk-elite-package-id', 'Elite (UK)', '6 sessions per week - 24 monthly credits', 37500, 'GBP', 'subscription', true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Package Items (link to subjects - example subjects)
INSERT INTO app.package_items (id, package_id, subject_id, hours, note)
SELECT 
  gen_random_uuid(),
  pkg.id,
  sub.id,
  CASE 
    WHEN pkg.name LIKE '%Foundation%' THEN 8
    WHEN pkg.name LIKE '%Mastery%' THEN 16
    WHEN pkg.name LIKE '%Elite%' THEN 24
    ELSE 8
  END,
  'Monthly credits - 30 min sessions'
FROM app.packages pkg
CROSS JOIN (
  SELECT id FROM app.subjects WHERE canonical_code = 'MATH' LIMIT 1
) sub
WHERE pkg.active = true
ON CONFLICT DO NOTHING;

-- Create user credits tracking table (if not exists)
CREATE TABLE IF NOT EXISTS "app"."user_credits" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "app"."users"(id),
  package_id UUID REFERENCES "app"."packages"(id),
  credits_total INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  credits_remaining INTEGER GENERATED ALWAYS AS (credits_total - credits_used) STORED,
  reset_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '30 days',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for user_credits
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON "app"."user_credits"(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credits_reset_date ON "app"."user_credits"(reset_date);

-- Create credit usage log table
CREATE TABLE IF NOT EXISTS "app"."credit_usage_logs" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "app"."users"(id),
  session_id UUID REFERENCES "app"."sessions"(id),
  credits_used INTEGER NOT NULL DEFAULT 1,
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT
);

-- Create indexes for credit usage logs
CREATE INDEX IF NOT EXISTS idx_credit_usage_user_id ON "app"."credit_usage_logs"(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_usage_session_id ON "app"."credit_usage_logs"(session_id);
CREATE INDEX IF NOT EXISTS idx_credit_usage_used_at ON "app"."credit_usage_logs"(used_at);
