-- Phase 10c — per-user API keys for the Chrome extension (and future programmatic access).
--
-- Each key: a plaintext secret of the form `sk-ic-<20-random-base32>` shown to the user
-- exactly once at creation time, and stored only as a SHA-256 hash. We also store a
-- short `prefix` (first 10 chars) so the /app/settings UI can show "sk-ic-abcd…" in the
-- listing without exposing the secret.
--
-- `revoked_at` lets us soft-delete; the auth path rejects keys with `revoked_at IS NOT NULL`
-- even if their hash still matches.

CREATE TABLE IF NOT EXISTS api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  prefix         TEXT NOT NULL,
  hashed_secret  TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);
-- Hot path: the auth middleware looks up keys by hashed_secret + revoked_at on every
-- request that doesn't carry a Supabase JWT. Supabase auto-creates an index for UNIQUE,
-- so we don't need a second one.

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Users see + manage only their own keys. Server-side code uses the service-role client
-- which bypasses RLS entirely, so the auth path can still verify arbitrary keys.
CREATE POLICY "own api keys" ON api_keys
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
