-- Phase 6a — core user-data tables for the dashboard.
-- Reference: docs/INTERVIEW-COPILOT-COMPLETE.txt §04 ARCHITECTURE Part 7.
--
-- Applied against the live Supabase DB via the `psql $SUPABASE_DB_URL -f <this>` path in
-- scripts/apply-migrations.sh. Later phases (6b CRUD, 6c billing) add more tables.
--
-- Every table has RLS enabled with a user_id = auth.uid() policy. The service_role client
-- used by the api + BullMQ workers bypasses RLS automatically.

-- ============================================================================
-- profiles — user metadata beyond what auth.users carries.
-- ============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name        TEXT,
  country          TEXT,                  -- ISO 3166-1 alpha-2 (IN, US, ...)
  target_roles     TEXT[] DEFAULT '{}',
  experience_years INT,
  onboarded_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile row on user sign-up so the app never has to insert-then-fetch.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- resumes, job_descriptions, personas — the "knowledge base" attached to sessions.
-- ============================================================================
CREATE TABLE IF NOT EXISTS resumes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  storage_path TEXT,                                -- Supabase Storage object path (PDF/DOCX)
  parsed_text  TEXT,                                -- BullMQ worker fills after parse
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS resumes_user_idx ON resumes(user_id);

CREATE TABLE IF NOT EXISTS job_descriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company    TEXT,
  role       TEXT,
  source_url TEXT,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jds_user_idx ON job_descriptions(user_id);

CREATE TABLE IF NOT EXISTS personas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS personas_user_idx ON personas(user_id);

-- ============================================================================
-- sessions + session_events + session_summaries
-- Live or practice interview lifecycle. session_events holds per-message audit for review.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('live', 'practice')),
  mode           TEXT NOT NULL DEFAULT 'auto',    -- auto / behavioral / coding / system_design
  language       TEXT NOT NULL DEFAULT 'en',
  llm_choice     TEXT NOT NULL DEFAULT 'auto',
  resume_id      UUID REFERENCES resumes(id) ON DELETE SET NULL,
  jd_id          UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
  persona_id     UUID REFERENCES personas(id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at       TIMESTAMPTZ,
  duration_s     INT,
  persist_transcripts BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS session_events (
  id         BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind       TEXT NOT NULL,                        -- transcript_partial / transcript_final / answer_delta / ...
  payload    JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS session_events_session_idx ON session_events(session_id, ts);

CREATE TABLE IF NOT EXISTS session_summaries (
  session_id   UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scores       JSONB NOT NULL,                     -- { communication: 0-5, specificity: 0-5, structure: 0-5, relevance: 0-5 }
  highlights   JSONB NOT NULL DEFAULT '[]'::jsonb,
  improvements JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Row-level security — user_id = auth.uid() on every table.
-- Service role (used server-side from api + workers) bypasses RLS automatically.
-- ============================================================================
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_descriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_summaries  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile"    ON profiles          FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own resumes"    ON resumes           FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own jds"        ON job_descriptions  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own personas"   ON personas          FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own sessions"   ON sessions          FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- session_events rows inherit visibility via the parent session.
CREATE POLICY "own session events" ON session_events FOR ALL USING (
  EXISTS (SELECT 1 FROM sessions WHERE sessions.id = session_events.session_id AND sessions.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM sessions WHERE sessions.id = session_events.session_id AND sessions.user_id = auth.uid())
);
CREATE POLICY "own summaries"  ON session_summaries FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- updated_at auto-maintenance for the mutable tables
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS profiles_updated ON profiles;
CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS resumes_updated ON resumes;
CREATE TRIGGER resumes_updated BEFORE UPDATE ON resumes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
