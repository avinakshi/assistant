/**
 * WebSocket / HTTP authentication — resolves the token into a concrete identity.
 *
 * Three supported modes, in resolution order:
 *
 *   - API key (Phase 10c): tokens shaped `sk-ic-<20-base32>` are hashed and looked up in
 *     the api_keys table. Live per-user, can be revoked independently of Supabase
 *     sessions. Ideal for the Chrome extension and future headless clients.
 *
 *   - JWT (Phase 6f): if the Supabase admin client is available, tokens that look like
 *     JWTs are verified via `supabase.auth.getUser(token)`. Returns the user's id.
 *
 *   - shared-secret (legacy / CI): any token matching WS_SHARED_SECRET is accepted
 *     anonymously. Used by integration tests that don't spin up Supabase.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { getSupabaseAdmin } from '../lib/supabase';
import { looksLikeApiKey, verifyApiKey } from '../lib/api-keys';

export type WsAuthResult =
  | { kind: 'user'; userId: string; email?: string; via?: 'jwt' | 'api-key' }
  | { kind: 'shared-secret' }
  | { kind: 'denied'; reason: 'missing-token' | 'bad-token' | 'jwt-invalid' | 'api-key-invalid' };

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

  const supabase = deps.supabase === undefined ? getSupabaseAdmin() : deps.supabase;

  // API key path — structurally disjoint from JWTs so order doesn't matter.
  if (looksLikeApiKey(rawToken)) {
    if (!supabase) {
      return { kind: 'denied', reason: 'api-key-invalid' };
    }
    const result = await verifyApiKey(supabase, rawToken);
    if (!result) return { kind: 'denied', reason: 'api-key-invalid' };
    return { kind: 'user', userId: result.userId, via: 'api-key' };
  }

  if (!looksLikeJwt(rawToken)) {
    return { kind: 'denied', reason: 'bad-token' };
  }

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
    via: 'jwt',
    ...(data.user.email ? { email: data.user.email } : {}),
  };
}
