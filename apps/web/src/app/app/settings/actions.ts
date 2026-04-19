'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

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

/**
 * Permanently delete the caller's account (Phase 13g).
 *
 * Steps:
 *   1. Verify the typed confirmation matches the user's email (guardrail so a
 *      misclick can't nuke someone).
 *   2. Delete every object in the user's Supabase Storage prefix — the `resumes`
 *      bucket stores uploads under `<user_id>/...`. Row-cascade doesn't reach
 *      storage blobs, so we have to walk the prefix explicitly.
 *   3. Call `auth.admin.deleteUser(userId)`. The DB schema has ON DELETE CASCADE
 *      from auth.users for every user-owned table, so this one call removes
 *      resumes / jds / sessions / session_events / api_keys / jd_resume_gaps /
 *      profiles in a single transaction.
 *   4. Sign the caller out locally and redirect to `/` so their session cookie
 *      doesn't keep referencing a now-nonexistent user.
 *
 * Irreversible by design. There's no soft-delete / restore window — keeping a
 * "deleted" flag around would defeat the GDPR "erasure" promise.
 */
export async function deleteAccountAction(
  confirmEmail: string,
): Promise<UpdateSettingsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  // Case-insensitive compare — Supabase stores emails lowercase but users will type
  // the form in however they type it. Trim handles the inevitable trailing space.
  if (confirmEmail.trim().toLowerCase() !== (user.email ?? '').toLowerCase()) {
    return {
      ok: false,
      error: 'typed email does not match the signed-in account — deletion canceled',
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: 'account deletion is not configured on this server' };
  }

  // Step 1: storage cleanup. list() only returns up to 1000 entries at a time; loop
  // until we hit an empty page. We purposefully don't short-circuit on errors here —
  // missing files aren't a reason to block the auth-row deletion below.
  try {
    const prefix = user.id;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: files } = await admin.storage
        .from('resumes')
        .list(prefix, { limit: 1000 });
      if (!files || files.length === 0) break;
      const paths = files.map((f) => `${prefix}/${f.name}`);
      await admin.storage.from('resumes').remove(paths);
      if (files.length < 1000) break; // last page
    }
  } catch {
    // Storage hiccups shouldn't block the actual account deletion. The auth row going
    // away is the GDPR-critical part; orphaned blobs are the scripted-cleanup kind of
    // problem, not a user-facing one.
  }

  // Step 2: delete the auth user. CASCADE fan-out does the rest of the schema.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  // Step 3: clear the local session cookies so the browser stops sending them, then
  // redirect to the marketing home. `redirect()` throws a Next-internal sentinel so
  // nothing after it runs.
  await supabase.auth.signOut();
  redirect('/');
}
