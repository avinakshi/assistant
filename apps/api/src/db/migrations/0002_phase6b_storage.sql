-- Phase 6b — Supabase Storage bucket for resume uploads.
-- Private bucket. Users can only CRUD objects under their own folder: `<user_id>/<filename>`.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  FALSE,
  10 * 1024 * 1024,  -- 10 MB cap per file; PDFs with scanned pages can push this
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Drop any existing policies (idempotent migrations) then recreate.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'resumes_own_read') THEN
    DROP POLICY resumes_own_read ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'resumes_own_write') THEN
    DROP POLICY resumes_own_write ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'resumes_own_delete') THEN
    DROP POLICY resumes_own_delete ON storage.objects;
  END IF;
END $$;

-- Path convention: `<uid>/<filename>`. `storage.foldername()` splits the key on '/'.
-- Enforcing that the first segment equals the caller's auth.uid() is the classic
-- Supabase per-user pattern. Service role bypasses all of this for server-side ops.

CREATE POLICY resumes_own_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY resumes_own_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY resumes_own_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);
