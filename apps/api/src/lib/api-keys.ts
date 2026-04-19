/**
 * Per-user API keys. Plaintext `sk-ic-<20-base32>` is shown to the user once, stored as
 * a SHA-256 hash. Looked up by hash in the WS auth path so scoped keys can replace the
 * short-lived Supabase JWT for headless / programmatic clients.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const API_KEY_PREFIX = 'sk-ic-';

export interface GeneratedKey {
  /** Shown to the user once, at creation time. Never persisted. */
  readonly plaintext: string;
  /** Persisted. */
  readonly hashed: string;
  /** First 10 chars of the plaintext, safe to show in listings. */
  readonly visiblePrefix: string;
}

/**
 * Generate a new `sk-ic-…` key. 20 base32 characters of entropy (100 bits) is overkill
 * for the use case; we're still rate-limited + quota-gated by the orchestrator anyway.
 */
export function generateApiKey(): GeneratedKey {
  const bytes = randomBytes(13); // 13 bytes → 20.8 base32 chars
  // RFC 4648 base32 without padding, lowercased. Avoids characters that look alike (0/O, 1/I).
  const base32 = encodeBase32(bytes).toLowerCase().slice(0, 20);
  const plaintext = `${API_KEY_PREFIX}${base32}`;
  return {
    plaintext,
    hashed: hashApiKey(plaintext),
    visiblePrefix: plaintext.slice(0, 10),
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function looksLikeApiKey(token: string): boolean {
  // Quick structural test without hitting the DB.
  return /^sk-ic-[a-z0-9]{20}$/.test(token);
}

/**
 * Look up an API key by plaintext; returns { userId } on success and null on miss.
 * The caller (authenticateWsToken) calls this after looksLikeApiKey passes.
 */
export async function verifyApiKey(
  supabase: SupabaseClient,
  plaintext: string,
): Promise<{ userId: string } | null> {
  const hashed = hashApiKey(plaintext);
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('hashed_secret', hashed)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; user_id: string; revoked_at: string | null };
  if (row.revoked_at !== null) return null;
  // Fire-and-forget last_used_at update — never block auth on the write.
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id);
  return { userId: row.user_id };
}

// ---- Base32 (RFC 4648) -----------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buf: Buffer): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}
