'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface UpdateSettingsResult {
  readonly ok: boolean;
  readonly error?: string;
}

export async function setPersistTranscriptsDefault(
  value: boolean,
): Promise<UpdateSettingsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const { error } = await supabase
    .from('profiles')
    .update({ persist_transcripts_default: value })
    .eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/settings');
  return { ok: true };
}
