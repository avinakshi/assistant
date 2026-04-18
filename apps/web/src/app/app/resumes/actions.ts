'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { parseResumeFile } from '@/lib/parse/resume';

export interface UploadResult {
  ok: boolean;
  resumeId?: string;
  error?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadResumeAction(formData: FormData): Promise<UploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'no file provided' };
  if (file.size === 0) return { ok: false, error: 'file is empty' };
  if (file.size > MAX_BYTES) return { ok: false, error: `file too large (${file.size} > ${MAX_BYTES} bytes)` };

  const name = ((formData.get('name') as string | null) ?? file.name).trim() || file.name;

  // Parse text + LLM structure. We do this BEFORE uploading to storage so that any parse
  // failure doesn't leave an orphan object in the bucket.
  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseResumeFile({
      bytes,
      mimeType: file.type,
      filename: file.name,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'parse failed' };
  }

  // Store the original file in Supabase Storage under <user_id>/<random>-<filename>.
  const storagePath = `${user.id}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
  const { error: uploadErr } = await supabase.storage
    .from('resumes')
    .upload(storagePath, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadErr) return { ok: false, error: `storage: ${uploadErr.message}` };

  // Insert the row. RLS requires user_id = auth.uid() in WITH CHECK — always set explicitly.
  const { data: row, error: insertErr } = await supabase
    .from('resumes')
    .insert({
      user_id: user.id,
      name,
      storage_path: storagePath,
      parsed_text: parsed.rawText,
    })
    .select('id')
    .single();

  if (insertErr || !row) {
    // Roll back the storage upload on row-insert failure so we don't leak bytes.
    await supabase.storage.from('resumes').remove([storagePath]);
    return { ok: false, error: insertErr?.message ?? 'insert failed' };
  }

  // First resume = auto-default so the dashboard feels alive.
  const { count } = await supabase
    .from('resumes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if (count === 1) {
    await supabase.from('resumes').update({ is_default: true }).eq('id', row.id);
  }

  revalidatePath('/app/resumes');
  revalidatePath('/app');
  return { ok: true, resumeId: row.id };
}

export async function setDefaultResumeAction(resumeId: string): Promise<UploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  // Clear all defaults, then set the chosen one. RLS confines the update to this user.
  await supabase.from('resumes').update({ is_default: false }).eq('user_id', user.id);
  const { error } = await supabase.from('resumes').update({ is_default: true }).eq('id', resumeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/app/resumes');
  revalidatePath('/app');
  return { ok: true };
}

export async function deleteResumeAction(resumeId: string): Promise<UploadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const { data: row } = await supabase
    .from('resumes')
    .select('storage_path')
    .eq('id', resumeId)
    .single();
  if (row?.storage_path) {
    await supabase.storage.from('resumes').remove([row.storage_path]);
  }
  const { error } = await supabase.from('resumes').delete().eq('id', resumeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/app/resumes');
  revalidatePath('/app');
  return { ok: true };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}
