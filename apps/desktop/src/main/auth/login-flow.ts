/**
 * Login flow controller. Orchestrates the three moving parts of Phase 6e:
 *
 *   1. `beginLogin` generates a random nonce, stores it in the auth-store, and returns
 *      the URL the desktop should open in the user's default browser.
 *   2. `parseCallbackUrl` decodes the `ic://auth-callback?…` URL that Electron hands us
 *      via `open-url` / `second-instance`. Pure function, no side effects.
 *   3. `completeLogin` validates the parsed payload against the stored pending state,
 *      writes the session to the auth-store, and returns the new session.
 *
 * All three are Electron-free so they can be unit-tested under vitest.
 */
import { randomBytes } from 'node:crypto';
import type { AuthStore, DesktopSession } from './auth-store';

export const IC_PROTOCOL = 'ic';
export const IC_CALLBACK_HOST = 'auth-callback';
const PENDING_TTL_MS = 10 * 60 * 1_000; // 10 min — typical time to click an email link
const CALLBACK_SKEW_MS = 60 * 1_000; // allow 60s of clock skew

export interface BeginLoginResult {
  readonly nonce: string;
  readonly browserUrl: string;
}

/** Generate a fresh nonce and compute the URL the desktop should open in the browser. */
export async function beginLogin(opts: {
  authStore: AuthStore;
  webBaseUrl: string;
}): Promise<BeginLoginResult> {
  const nonce = randomBytes(16).toString('hex');
  await opts.authStore.setPendingState(nonce, PENDING_TTL_MS);

  const url = new URL('/login', opts.webBaseUrl);
  url.searchParams.set('from', 'desktop');
  url.searchParams.set('state', nonce);
  return { nonce, browserUrl: url.toString() };
}

export interface ParsedCallback {
  readonly state: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly userId: string;
  readonly email?: string;
}

export class CallbackParseError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'bad-url'
      | 'wrong-scheme'
      | 'wrong-host'
      | 'missing-field'
      | 'bad-expires',
  ) {
    super(message);
    this.name = 'CallbackParseError';
  }
}

/**
 * Parse an ic://auth-callback?state=…&access_token=…&refresh_token=…&expires_at=…&user_id=…
 * URL into a typed payload. Throws CallbackParseError with a discriminant on failure.
 *
 * Accepts `expires_at` as either unix seconds OR ISO 8601. Supabase returns seconds in
 * getSession(), so that's the primary path; ISO is a cushion against future drift.
 */
export function parseCallbackUrl(raw: string): ParsedCallback {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CallbackParseError('invalid URL', 'bad-url');
  }

  // `new URL('ic://auth-callback?...')` parses scheme as `ic:` (with colon).
  const scheme = url.protocol.replace(/:$/, '');
  if (scheme !== IC_PROTOCOL) {
    throw new CallbackParseError(`expected scheme '${IC_PROTOCOL}', got '${scheme}'`, 'wrong-scheme');
  }
  if (url.host !== IC_CALLBACK_HOST) {
    throw new CallbackParseError(`expected host '${IC_CALLBACK_HOST}', got '${url.host}'`, 'wrong-host');
  }

  const q = url.searchParams;
  const state = q.get('state');
  const accessToken = q.get('access_token');
  const refreshToken = q.get('refresh_token');
  const expiresAtRaw = q.get('expires_at');
  const userId = q.get('user_id');
  const email = q.get('email') ?? undefined;

  if (!state || !accessToken || !refreshToken || !expiresAtRaw || !userId) {
    throw new CallbackParseError('missing required param', 'missing-field');
  }

  const expiresAt = parseExpiresAt(expiresAtRaw);
  if (expiresAt === null) {
    throw new CallbackParseError(`bad expires_at: ${expiresAtRaw}`, 'bad-expires');
  }

  return {
    state,
    accessToken,
    refreshToken,
    expiresAt,
    userId,
    ...(email ? { email } : {}),
  };
}

function parseExpiresAt(v: string): number | null {
  const asNum = Number(v);
  if (Number.isFinite(asNum) && asNum > 0) return asNum;
  const asDate = Date.parse(v);
  if (Number.isFinite(asDate)) return Math.floor(asDate / 1_000);
  return null;
}

export class CallbackAuthError extends Error {
  constructor(
    message: string,
    readonly reason: 'no-pending' | 'state-mismatch' | 'expired',
  ) {
    super(message);
    this.name = 'CallbackAuthError';
  }
}

/**
 * Finish a login: validate the callback's state matches the pending state we generated,
 * check expiry sanity, write the session to the store, clear the pending marker.
 */
export async function completeLogin(opts: {
  authStore: AuthStore;
  callback: ParsedCallback;
  now?: number;
}): Promise<DesktopSession> {
  const pending = opts.authStore.getPendingState();
  if (!pending) {
    throw new CallbackAuthError('no pending login', 'no-pending');
  }
  if (pending.nonce !== opts.callback.state) {
    // Clear the pending state so a stale ic:// URL can't be replayed.
    await opts.authStore.clearPendingState();
    throw new CallbackAuthError('state mismatch', 'state-mismatch');
  }

  const nowSec = Math.floor((opts.now ?? Date.now()) / 1_000);
  if (opts.callback.expiresAt <= nowSec + Math.ceil(CALLBACK_SKEW_MS / 1_000)) {
    await opts.authStore.clearPendingState();
    throw new CallbackAuthError('access token already expired', 'expired');
  }

  const session: DesktopSession = {
    userId: opts.callback.userId,
    accessToken: opts.callback.accessToken,
    refreshToken: opts.callback.refreshToken,
    expiresAt: opts.callback.expiresAt,
    ...(opts.callback.email ? { email: opts.callback.email } : {}),
  };
  await opts.authStore.setSession(session);
  return session;
}
