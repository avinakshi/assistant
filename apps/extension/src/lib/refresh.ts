/**
 * Supabase token refresher for the extension. Given the refresh token and the Supabase
 * project URL + anon key, calls /auth/v1/token?grant_type=refresh_token to get a new
 * access_token. Pure HTTP — no SDK bundled (keeps extension small).
 *
 * Called from api.ts when a request returns 401, and proactively from storage.ts's
 * getFreshAccessToken when the stored access_token is close to expiring.
 */

export interface RefreshedSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Unix seconds when the new access token expires. */
  readonly expiresAt: number;
}

export class RefreshError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RefreshError';
  }
}

const FETCH_TIMEOUT_MS = 8_000;

export async function refreshSupabaseSession(opts: {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly refreshToken: string;
}): Promise<RefreshedSession> {
  const url = `${opts.supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: opts.supabaseAnonKey,
      },
      body: JSON.stringify({ refresh_token: opts.refreshToken }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new RefreshError(`refresh failed HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
    }
    const body = (await res.json()) as Record<string, unknown>;
    const accessToken =
      typeof body['access_token'] === 'string' ? (body['access_token'] as string) : '';
    const refreshToken =
      typeof body['refresh_token'] === 'string'
        ? (body['refresh_token'] as string)
        : opts.refreshToken;
    // Supabase returns expires_at (seconds since epoch) and expires_in (seconds).
    // Prefer expires_at; fall back to "now + expires_in".
    const expiresAt =
      typeof body['expires_at'] === 'number'
        ? (body['expires_at'] as number)
        : typeof body['expires_in'] === 'number'
          ? Math.floor(Date.now() / 1_000) + (body['expires_in'] as number)
          : Math.floor(Date.now() / 1_000) + 3_600;
    if (!accessToken) throw new RefreshError('refresh returned no access_token', 200);
    return { accessToken, refreshToken, expiresAt };
  } finally {
    clearTimeout(to);
  }
}

/**
 * True when the access token is within `skewSeconds` of expiry. Used by the popup to
 * decide whether to proactively refresh before firing a real API call.
 */
export function tokenNeedsRefresh(expiresAt: number | undefined, nowSec = Math.floor(Date.now() / 1_000), skewSeconds = 60): boolean {
  if (!expiresAt) return false; // unknown expiry — treat as fresh and let 401 drive refresh
  return expiresAt <= nowSec + skewSeconds;
}
