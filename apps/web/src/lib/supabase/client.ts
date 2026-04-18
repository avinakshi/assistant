/**
 * Supabase browser client. Used by Client Components for interactive auth flows
 * (sign in with OAuth redirect, sign out). Session state is still sourced from cookies,
 * so server components stay in sync.
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
}
