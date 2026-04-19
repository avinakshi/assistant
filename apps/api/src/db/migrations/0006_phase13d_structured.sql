-- Phase 13d: structured resume editor + per-session extra instructions.
--
-- Two additive columns, both nullable so this migration is safe on live data:
--
--   resumes.structured_json JSONB
--     Populated by the resume parser on upload (lib/parse/resume.ts → ResumeSummary +
--     experience/projects/certifications). Viewed + edited on the resume detail page so
--     the user can fix parser mistakes without re-uploading the PDF. When present, the
--     structured form is preferred over `parsed_text` for AnswerContext.resume because
--     it gives the LLM a much cleaner signal (typed fields vs blob of OCR text).
--
--   sessions.extra_instructions TEXT
--     Free-form bias the user types before starting a session. Threaded into the LLM
--     prompt as a candidate-voice constraint (e.g. "emphasize leadership examples",
--     "target Google L6", "answer in Hindi"). 2000-char cap enforced at the app layer,
--     not the DB (so loosening later doesn't need another migration).

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS structured_json JSONB;

COMMENT ON COLUMN resumes.structured_json IS
  'Structured resume fields extracted by the parser (summary, experience[], skills[], education[], projects[]). Edited via the resume detail page.';

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS extra_instructions TEXT;

COMMENT ON COLUMN sessions.extra_instructions IS
  'Free-form bias supplied at session start. Passed to the LLM as a candidate-voice hint.';
