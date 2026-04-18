/**
 * WebSocket authentication — resolves the `?token=` query param into a concrete identity.
 *
 * Two supported modes, chosen at runtime based on what's configured:
 *
 *   - JWT (Phase 6f): if the Supabase admin client is available, tokens that look like
 *     JWTs are verified via `supabase.auth.getUser(token)` which calls `/auth/v1/user`.
 *     Returns the user's id.
 *
 *   - shared-secret (legacy / CI): any token matching WS_SHARED_SECRET is accepted
 *     anonymously. Used by integration tests that don't spin up Supabase.
 *
 * Anything else is rejected.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { getSupabaseAdmin } from '../lib/supabase';

export type WsAuthResult =
  | { kind: 'user'; userId: string; email?: string }
  | { kind: 'shared-secret' }
  | { kind: 'denied'; reason: 'missing-token' | 'bad-token' | 'jwt-invalid' };

export interface WsAuthDeps {
  /** Override for tests. Defaults to the process-wide admin client. */
  supabase?: SupabaseClient | null;
}

/** Rough JWT sniff — 3 base64url segments separated by dots. Good enough to route. */
function looksLikeJwt(token: string): boolean {
  if (token.length < 20) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  return parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
}

export async function authenticateWsToken(
  rawToken: string | null,
  deps: WsAuthDeps = {},
): Promise<WsAuthResult> {
  if (!rawToken) return { kind: 'denied', reason: 'missing-token' };

  // Shared-secret short-circuit. Comes first so tests work even when Supabase is partly
  // configured.
  if (rawToken === config.WS_SHARED_SECRET) {
    return { kind: 'shared-secret' };
  }

  if (!looksLikeJwt(rawToken)) {
    return { kind: 'denied', reason: 'bad-token' };
  }

  const supabase = deps.supabase === undefined ? getSupabaseAdmin() : deps.supabase;
  if (!supabase) {
    // JWT-shaped token but we have no Supabase client to verify it. Treat as denied so we
    // never "fail open" on a forged token.
    return { kind: 'denied', reason: 'jwt-invalid' };
  }

  const { data, error } = await supabase.auth.getUser(rawToken);
  if (error || !data?.user) {
    return { kind: 'denied', reason: 'jwt-invalid' };
  }
  return {
    kind: 'user',
    userId: data.user.id,
    ...(data.user.email ? { email: data.user.email } : {}),
  };
}
