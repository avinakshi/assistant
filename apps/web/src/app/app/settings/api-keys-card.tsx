'use client';

import { useEffect, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; keys: ApiKey[] }
  | { kind: 'no-session' }
  | { kind: 'error'; message: string };

/**
 * Minimal CRUD UI for per-user API keys. List + create + revoke. New-key plaintext is
 * surfaced in a one-shot banner the user must copy before it disappears on navigation.
 */
export function ApiKeysCard() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [newName, setNewName] = useState('');
  const [recentPlaintext, setRecentPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

  const load = () => {
    const supabase = createClient();
    void supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token) {
        setPhase({ kind: 'no-session' });
        return;
      }
      try {
        const res = await fetch(`${apiBase}/api/keys`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setPhase({ kind: 'error', message: `HTTP ${res.status}` });
          return;
        }
        const body = (await res.json()) as { keys: ApiKey[] };
        setPhase({ kind: 'ready', keys: body.keys });
      } catch (err) {
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = () => {
    if (!newName.trim()) return;
    startTransition(() => {
      void (async () => {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch(`${apiBase}/api/keys`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: newName.trim() }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          setPhase({ kind: 'error', message: `Create failed: ${body.slice(0, 200)}` });
          return;
        }
        const body = (await res.json()) as { plaintext: string };
        setRecentPlaintext(body.plaintext);
        setNewName('');
        load();
      })();
    });
  };

  const revoke = (id: string, name: string) => {
    if (!window.confirm(`Revoke key "${name}"? This can’t be undone.`)) return;
    startTransition(() => {
      void (async () => {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        await fetch(`${apiBase}/api/keys/${id}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        });
        load();
      })();
    });
  };

  const copyPlaintext = async () => {
    if (!recentPlaintext) return;
    try {
      await navigator.clipboard.writeText(recentPlaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* clipboard blocked — the user can still select + copy manually */
    }
  };

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="text-sm font-semibold text-ink-900">API keys</div>
      <p className="mt-1 text-xs text-ink-500">
        Long-lived tokens scoped to you. Alternative to the 1-hour Supabase session —
        paste the plaintext into the Chrome extension or use it for headless scripts. Each
        key is shown once when created.
      </p>

      {recentPlaintext && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-xs font-semibold text-emerald-800">New key created</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 select-all overflow-x-auto rounded bg-white px-2 py-1.5 font-mono text-[11px] text-ink-900">
              {recentPlaintext}
            </code>
            <button
              type="button"
              onClick={() => void copyPlaintext()}
              className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <div className="mt-2 text-[11px] text-emerald-800">
            Copy now — this is the only time you’ll see the full key.
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <label htmlFor="new-api-key-name" className="sr-only">
          New API key name
        </label>
        <input
          id="new-api-key-name"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name (e.g. chrome-laptop)"
          className="flex-1 rounded-md border border-ink-100 bg-white px-3 py-1.5 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
        <button
          type="button"
          onClick={create}
          disabled={pending || !newName.trim()}
          className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Create
        </button>
      </div>

      {phase.kind === 'loading' && (
        <div className="mt-3 text-xs text-ink-500">Loading keys…</div>
      )}
      {phase.kind === 'no-session' && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          You’re signed out in this tab.
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {phase.message}
        </div>
      )}
      {phase.kind === 'ready' && (
        <ul className="mt-4 divide-y divide-ink-100 rounded-md border border-ink-100">
          {phase.keys.length === 0 ? (
            <li className="p-3 text-xs text-ink-500">No API keys yet.</li>
          ) : (
            phase.keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-900">
                    {k.name}
                    {k.revoked_at && (
                      <span className="ml-2 text-[10px] font-normal text-red-700">
                        revoked
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-ink-500">
                    {k.prefix}…
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-500">
                    Created {new Date(k.created_at).toLocaleDateString()}
                    {k.last_used_at && ` · last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                {!k.revoked_at && (
                  <button
                    type="button"
                    onClick={() => revoke(k.id, k.name)}
                    disabled={pending}
                    className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
