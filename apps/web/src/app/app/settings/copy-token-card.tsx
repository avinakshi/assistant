'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type State = 'loading' | 'ready' | 'no-session' | 'copied' | 'error';

/**
 * Shows the user's current Supabase access_token + a copy button. The Chrome extension
 * can't read browser cookies (host isolation), so today the simplest auth path is:
 * paste the token from here into the extension's Config panel.
 *
 * Tokens expire ~1 hour; the user can regrab any time. A follow-up could wire a
 * longer-lived API key model, but MVP keeps it simple.
 */
export function CopyTokenCard() {
  const [state, setState] = useState<State>('loading');
  const [token, setToken] = useState('');

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setState('no-session');
        return;
      }
      setToken(data.session.access_token);
      setState('ready');
    });
  }, []);

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setState('copied');
      setTimeout(() => setState('ready'), 2_000);
    } catch {
      setState('error');
    }
  };

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="text-sm font-semibold text-ink-900">Chrome extension token</div>
      <p className="mt-1 text-xs text-ink-500">
        The Chrome extension needs your access token to call the API on your behalf.
        Paste it into the extension\u2019s Config panel. Tokens expire after about an hour
        \u2014 come back here to grab a fresh one if the extension says "token rejected".
      </p>
      {state === 'loading' && (
        <div className="mt-3 text-xs text-ink-500">Loading session\u2026</div>
      )}
      {state === 'no-session' && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          You\u2019re signed out in this tab. Refresh or sign in again.
        </div>
      )}
      {(state === 'ready' || state === 'copied' || state === 'error') && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-ink-50 px-2 py-1.5 text-xs font-mono text-ink-700">
              {token.slice(0, 12)}\u2026{token.slice(-8)}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              {state === 'copied' ? 'Copied \u2713' : 'Copy'}
            </button>
          </div>
          {state === 'error' && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              Clipboard access blocked. Select the token above and copy manually.
            </div>
          )}
          <div className="mt-3 text-[11px] text-ink-500">
            Tip: if the extension popup is open, the pasted token takes effect immediately
            once you click <em>Save</em>.
          </div>
        </>
      )}
    </div>
  );
}
