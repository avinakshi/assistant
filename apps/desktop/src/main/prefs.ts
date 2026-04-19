/**
 * User preference fetcher for the desktop.
 *
 * On every session start, the desktop asks the api for the signed-in user's saved
 * preferences (today: just persist_transcripts_default). If anything goes wrong —
 * network, bad JWT, 500 — we fall back to `true`, matching the previously hardcoded
 * behavior. The price of failure is a single spurious transcript persistence that
 * the user can delete from /app/sessions. That's acceptable; aborting the session
 * start over a preference lookup would be worse UX.
 *
 * Runs in the Electron main process; uses Node 20's global `fetch`.
 */
import { logger } from './logger';

export interface UserPrefs {
  readonly persistTranscriptsDefault: boolean;
}

const DEFAULT_PREFS: UserPrefs = { persistTranscriptsDefault: true };
const FETCH_TIMEOUT_MS = 3_000;

export async function fetchUserPrefs(opts: {
  readonly apiBaseUrl: string;
  readonly token: string | undefined;
}): Promise<UserPrefs> {
  if (!opts.token) {
    // Unauth'd (dev/CI shared-secret) — nothing to look up, use defaults.
    return DEFAULT_PREFS;
  }
  const url = `${opts.apiBaseUrl.replace(/\/$/, '')}/api/prefs`;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${opts.token}` },
      signal: ac.signal,
    });
    if (!res.ok) {
      logger.info(
        { status: res.status, url },
        'prefs fetch non-ok — using defaults',
      );
      return DEFAULT_PREFS;
    }
    const body = (await res.json()) as unknown;
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { persistTranscriptsDefault?: unknown }).persistTranscriptsDefault !==
        'boolean'
    ) {
      logger.warn({ url }, 'prefs: malformed response — using defaults');
      return DEFAULT_PREFS;
    }
    return {
      persistTranscriptsDefault: (body as { persistTranscriptsDefault: boolean })
        .persistTranscriptsDefault,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.info({ err: msg }, 'prefs fetch failed — using defaults');
    return DEFAULT_PREFS;
  } finally {
    clearTimeout(to);
  }
}
