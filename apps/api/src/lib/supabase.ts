/**
 * Supabase admin client — uses the service role key so it bypasses RLS. Only used
 * from server code (the api process). Never ship this client reference or the
 * service-role key to clients.
 *
 * Returns `null` if either SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is unset. Callers
 * must tolerate a null client: Phase 6f falls back to shared-secret auth and skips DB
 * persistence + quota enforcement in that mode, so CI and pre-Supabase local dev keep
 * working.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let cached: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    cached = null;
    return null;
  }
  cached = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    // The admin client never has a session of its own; it just signs requests with the
    // service-role key. Turning off session persistence avoids pinging auth.users on
    // each call and eliminates any chance of accidental session cookie leakage.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** For tests — force a fresh read on next getSupabaseAdmin(). */
export function _resetSupabaseAdminForTests(): void {
  cached = undefined;
}
