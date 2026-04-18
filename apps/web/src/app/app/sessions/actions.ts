'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface DeleteResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Delete a session by id. RLS restricts to the signed-in user's own rows, and the FK
 * cascade on session_events + session_summaries handles child cleanup.
 *
 * Note: we don't distinguish practice vs live here — users can prune either.
 */
export async function deleteSessionAction(id: string): Promise<DeleteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const { error } = await supabase.from('sessions').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/sessions');
  revalidatePath('/app/practice');
  revalidatePath('/app');
  return { ok: true };
}
