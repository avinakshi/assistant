'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type State = 'loading' | 'ready' | 'no-session' | 'copied' | 'error';

/**
 * Builds a session-bundle JSON the Chrome extension consumes with one paste. The
 * extension uses the refresh token to auto-renew the access token when it expires, so
 * the user doesn't have to come back and re-copy every hour — unlike the original
 * "just copy the access token" design.
 *
 * The anon key + Supabase URL are embedded too since the refresh endpoint lives on the
 * Supabase project and needs both. Safe to expose (anon key is public by design).
 */

interface SessionBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl?: string;
}

export function CopyTokenCard() {
  const [state, setState] = useState<State>('loading');
  const [bundle, setBundle] = useState<SessionBundle | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setState('no-session');
        return;
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      setBundle({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? Math.floor(Date.now() / 1_000) + 3_600,
        supabaseUrl,
        supabaseAnonKey,
        ...(apiBaseUrl ? { apiBaseUrl } : {}),
      });
      setState('ready');
    });
  }, []);

  const json = bundle ? JSON.stringify(bundle, null, 2) : '';

  const copy = async () => {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setState('copied');
      setTimeout(() => setState('ready'), 2_000);
    } catch {
      setState('error');
    }
  };

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="text-sm font-semibold text-ink-900">Chrome extension session</div>
      <p className="mt-1 text-xs text-ink-500">
        Paste this JSON into the extension’s Config → Session JSON field. The
        extension keeps refreshing on its own after that — you won’t need to come
        back here unless you sign out or switch devices.
      </p>
      {state === 'loading' && (
        <div className="mt-3 text-xs text-ink-500">Loading session…</div>
      )}
      {state === 'no-session' && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          You’re signed out in this tab. Refresh or sign in again.
        </div>
      )}
      {(state === 'ready' || state === 'copied' || state === 'error') && bundle && (
        <>
          <pre className="mt-3 max-h-48 overflow-y-auto rounded bg-ink-50 p-3 text-[11px] font-mono text-ink-700">
            {json}
          </pre>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-500">
              Access token expires {new Date(bundle.expiresAt * 1000).toLocaleTimeString()};
              refresh token valid much longer.
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              {state === 'copied' ? 'Copied ✓' : 'Copy JSON'}
            </button>
          </div>
          {state === 'error' && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              Clipboard access blocked. Select the JSON above and copy manually.
            </div>
          )}
        </>
      )}
    </div>
  );
}
