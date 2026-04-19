/**
 * Service-role Supabase client for privileged server-only operations (account deletion,
 * storage cleanup when RLS would block the anon-role path, etc.). Never imported from
 * anything that ends up in the browser bundle — this file has `server-only` at the top
 * to make violations loud.
 *
 * Returns `null` when SUPABASE_SERVICE_ROLE_KEY is unset so server actions can return a
 * meaningful "not configured" error in local dev instead of exploding.
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

export function createAdminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
