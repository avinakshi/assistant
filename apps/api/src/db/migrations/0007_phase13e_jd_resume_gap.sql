-- Phase 13e: JD ↔ resume gap analysis cache.
--
-- One row per (resume_id, jd_id) pair. The API route hashes the (resume.updated_at,
-- jd.updated_at) tuple into `source_hash` so an edit to either side naturally invalidates
-- the cached row (we just rewrite). Cache lives ~forever; the storage cost is trivial
-- compared to the Gemini call it saves on every session pre-start.

CREATE TABLE IF NOT EXISTS jd_resume_gaps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_id     UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  jd_id         UUID NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
  source_hash   TEXT NOT NULL,
  analysis      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, resume_id, jd_id)
);

CREATE INDEX IF NOT EXISTS jd_resume_gaps_user_idx ON jd_resume_gaps (user_id);

ALTER TABLE jd_resume_gaps ENABLE ROW LEVEL SECURITY;

-- RLS: users can only see their own rows. The service-role client (api backend) bypasses
-- this anyway, but we want the direct Supabase read path (if ever used) to be safe.
DROP POLICY IF EXISTS "own jd_resume_gaps" ON jd_resume_gaps;
CREATE POLICY "own jd_resume_gaps" ON jd_resume_gaps FOR ALL USING (user_id = auth.uid());

COMMENT ON TABLE jd_resume_gaps IS
  'Gap analysis cache. source_hash is a sha256 of (resume.updated_at, jd.updated_at); rewrite on mismatch.';
