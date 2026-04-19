/**
 * Thin wrapper around chrome.storage.local. Extension config holds both the short-lived
 * Supabase access token and the long-lived refresh token so we can renew automatically
 * on 401s.
 *
 * The Supabase URL + anon key are persisted per-user (pasted from the settings page)
 * because we refresh directly against `<url>/auth/v1/token` — we don't want to hardcode
 * a specific project in the extension shipping to Chrome Web Store.
 */

export interface ExtensionConfig {
  readonly accessToken?: string;
  readonly refreshToken?: string;
  /** Unix seconds when the access token expires. */
  readonly expiresAt?: number;
  readonly supabaseUrl?: string;
  readonly supabaseAnonKey?: string;
  readonly apiBaseUrl?: string;
}

const DEFAULT_API = 'http://localhost:3001';

export async function readConfig(): Promise<ExtensionConfig> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['accessToken', 'refreshToken', 'expiresAt', 'supabaseUrl', 'supabaseAnonKey', 'apiBaseUrl'],
      (items) => {
        const accessToken =
          typeof items['accessToken'] === 'string' ? (items['accessToken'] as string) : undefined;
        const refreshToken =
          typeof items['refreshToken'] === 'string' ? (items['refreshToken'] as string) : undefined;
        const expiresAt =
          typeof items['expiresAt'] === 'number' ? (items['expiresAt'] as number) : undefined;
        const supabaseUrl =
          typeof items['supabaseUrl'] === 'string' ? (items['supabaseUrl'] as string) : undefined;
        const supabaseAnonKey =
          typeof items['supabaseAnonKey'] === 'string'
            ? (items['supabaseAnonKey'] as string)
            : undefined;
        const apiBaseUrl =
          typeof items['apiBaseUrl'] === 'string' ? (items['apiBaseUrl'] as string) : DEFAULT_API;
        resolve({
          ...(accessToken ? { accessToken } : {}),
          ...(refreshToken ? { refreshToken } : {}),
          ...(expiresAt !== undefined ? { expiresAt } : {}),
          ...(supabaseUrl ? { supabaseUrl } : {}),
          ...(supabaseAnonKey ? { supabaseAnonKey } : {}),
          apiBaseUrl,
        });
      },
    );
  });
}

export async function writeConfig(cfg: ExtensionConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        ...(cfg.accessToken !== undefined ? { accessToken: cfg.accessToken } : {}),
        ...(cfg.refreshToken !== undefined ? { refreshToken: cfg.refreshToken } : {}),
        ...(cfg.expiresAt !== undefined ? { expiresAt: cfg.expiresAt } : {}),
        ...(cfg.supabaseUrl !== undefined ? { supabaseUrl: cfg.supabaseUrl } : {}),
        ...(cfg.supabaseAnonKey !== undefined ? { supabaseAnonKey: cfg.supabaseAnonKey } : {}),
        ...(cfg.apiBaseUrl !== undefined ? { apiBaseUrl: cfg.apiBaseUrl } : {}),
      },
      () => resolve(),
    );
  });
}

export async function clearSession(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['accessToken', 'refreshToken', 'expiresAt'], () => resolve());
  });
}

/**
 * Shape the settings page writes to clipboard. Easiest flow for the user: one paste
 * into the extension and every field lands at once. Parsed tolerantly so older bundle
 * shapes degrade gracefully.
 */
export interface SessionBundle {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly apiBaseUrl?: string;
}

export function parseSessionBundle(raw: string): SessionBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const accessToken = typeof o['accessToken'] === 'string' ? (o['accessToken'] as string) : '';
  const refreshToken = typeof o['refreshToken'] === 'string' ? (o['refreshToken'] as string) : '';
  const expiresAt = typeof o['expiresAt'] === 'number' ? (o['expiresAt'] as number) : 0;
  const supabaseUrl = typeof o['supabaseUrl'] === 'string' ? (o['supabaseUrl'] as string) : '';
  const supabaseAnonKey =
    typeof o['supabaseAnonKey'] === 'string' ? (o['supabaseAnonKey'] as string) : '';
  if (!accessToken || !refreshToken || !supabaseUrl || !supabaseAnonKey) return null;
  const apiBaseUrl = typeof o['apiBaseUrl'] === 'string' ? (o['apiBaseUrl'] as string) : undefined;
  return {
    accessToken,
    refreshToken,
    expiresAt,
    supabaseUrl,
    supabaseAnonKey,
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
  };
}
