-- Phase 9b — user-level default for live-session transcript persistence.
--
-- The desktop currently hardcodes persistTranscripts=true at session.start. Users who
-- prefer not to have their live interviews persisted can flip this default from the web
-- settings page. The desktop will read it via an api endpoint in a future sub-phase; for
-- now the column is additive-only and the web UI writes to it.
--
-- DEFAULT TRUE matches the current desktop behavior, so existing users are undisturbed.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS persist_transcripts_default BOOLEAN NOT NULL DEFAULT TRUE;
