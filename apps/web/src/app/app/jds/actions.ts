'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fetchJdFromUrl } from '@/lib/parse/jd';

export interface JdResult {
  ok: boolean;
  jdId?: string;
  error?: string;
}

const MAX_BODY_CHARS = 50_000;

export async function createJdAction(formData: FormData): Promise<JdResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const mode = (formData.get('mode') as string | null) ?? 'paste';
  const company = ((formData.get('company') as string | null) ?? '').trim() || null;
  const role = ((formData.get('role') as string | null) ?? '').trim() || null;

  let body = '';
  let sourceUrl: string | null = null;
  let autoCompany: string | null = null;
  let autoRole: string | null = null;

  if (mode === 'url') {
    const url = ((formData.get('url') as string | null) ?? '').trim();
    if (!url) return { ok: false, error: 'URL required' };
    try {
      const fetched = await fetchJdFromUrl(url);
      body = fetched.body;
      sourceUrl = fetched.url;
      autoCompany = fetched.company ?? null;
      autoRole = fetched.role ?? null;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
    }
  } else {
    body = ((formData.get('body') as string | null) ?? '').trim();
    if (!body) return { ok: false, error: 'body required' };
  }

  if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS);
  if (body.length === 0) return { ok: false, error: 'empty JD body' };

  const { data: row, error } = await supabase
    .from('job_descriptions')
    .insert({
      user_id: user.id,
      company: company ?? autoCompany,
      role: role ?? autoRole,
      source_url: sourceUrl,
      body,
    })
    .select('id')
    .single();

  if (error || !row) return { ok: false, error: error?.message ?? 'insert failed' };

  revalidatePath('/app/jds');
  revalidatePath('/app');
  return { ok: true, jdId: row.id };
}

export async function deleteJdAction(id: string): Promise<JdResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('job_descriptions').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/app/jds');
  revalidatePath('/app');
  return { ok: true };
}
