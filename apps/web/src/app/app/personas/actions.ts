'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface PersonaResult {
  ok: boolean;
  personaId?: string;
  error?: string;
}

const MAX_PROMPT_CHARS = 10_000;

export async function createPersonaAction(formData: FormData): Promise<PersonaResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const name = ((formData.get('name') as string | null) ?? '').trim();
  const systemPrompt = ((formData.get('system_prompt') as string | null) ?? '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  if (!systemPrompt) return { ok: false, error: 'system prompt is required' };
  if (systemPrompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, error: `prompt too long (> ${MAX_PROMPT_CHARS})` };
  }

  const { data: row, error } = await supabase
    .from('personas')
    .insert({ user_id: user.id, name, system_prompt: systemPrompt })
    .select('id')
    .single();
  if (error || !row) return { ok: false, error: error?.message ?? 'insert failed' };

  const { count } = await supabase
    .from('personas')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if (count === 1) {
    await supabase.from('personas').update({ is_default: true }).eq('id', row.id);
  }

  revalidatePath('/app/personas');
  revalidatePath('/app');
  return { ok: true, personaId: row.id };
}

export async function setDefaultPersonaAction(id: string): Promise<PersonaResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  await supabase.from('personas').update({ is_default: false }).eq('user_id', user.id);
  const { error } = await supabase.from('personas').update({ is_default: true }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/app/personas');
  revalidatePath('/app');
  return { ok: true };
}

export async function deletePersonaAction(id: string): Promise<PersonaResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('personas').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/app/personas');
  revalidatePath('/app');
  return { ok: true };
}
