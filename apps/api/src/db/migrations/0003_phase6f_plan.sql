-- Phase 6f — user plan + quota groundwork.
--
-- Adds a `plan` column to profiles. Four legal values today:
--   - free       (default — 10 live minutes / rolling 7 days)
--   - starter    (Razorpay ₹299/mo — 10 hours / week, enforced by api)
--   - pro        (Razorpay ₹699/mo — unlimited)
--   - lifetime   (Stripe one-time — unlimited)
--
-- Billing webhooks (Phase 6c/6d) will UPDATE this column. Until those are wired,
-- everyone sits on 'free'. The check constraint guards against typos from manual
-- admin SQL during beta.
--
-- No data backfill needed — DEFAULT 'free' applies retroactively to existing rows.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'starter', 'pro', 'lifetime'));

-- An index helps the `WHERE plan = 'pro'` style admin queries; tiny table so it's cheap.
CREATE INDEX IF NOT EXISTS profiles_plan_idx ON profiles(plan);
