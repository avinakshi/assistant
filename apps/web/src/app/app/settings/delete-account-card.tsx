'use client';

import { useState, useTransition } from 'react';
import { deleteAccountAction } from './actions';

/**
 * Destructive-action card. Two-step flow:
 *   1. Click "Delete account" → reveals a confirmation panel.
 *   2. User types their exact email → button enables → server action fires.
 * The server action also verifies the typed email, so even a tampered client can't
 * skip the guard.
 */
export function DeleteAccountCard({ email }: { readonly email: string }) {
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  const confirm = () => {
    setError(null);
    startTransition(() => {
      void (async () => {
        const res = await deleteAccountAction(typed);
        // Success redirects server-side; only failure paths return here.
        if (!res.ok) setError(res.error ?? 'delete failed');
      })();
    });
  };

  return (
    <div className="rounded-xl border border-red-200 bg-white p-5">
      <div className="text-sm font-semibold text-red-900">Delete account</div>
      <p className="mt-1 text-xs text-ink-500">
        Permanently removes your account, uploaded resumes, job descriptions, session
        recordings and transcripts, API keys, and any other data tied to you. This cannot
        be undone.
      </p>

      {!revealed && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-3 rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          Delete account…
        </button>
      )}

      {revealed && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-medium text-red-900">
            Type your email to confirm: <code>{email}</code>
          </div>
          <input
            type="email"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Type your email to confirm deletion"
            className="mt-2 block w-full rounded border border-red-200 bg-white px-3 py-1.5 text-sm text-ink-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
            placeholder={email}
          />
          {error && (
            <div className="mt-2 rounded border border-red-300 bg-white p-2 text-xs text-red-800">
              {error}
            </div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setRevealed(false);
                setTyped('');
                setError(null);
              }}
              disabled={pending}
              className="rounded border border-ink-100 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!matches || pending}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? 'Deleting…' : 'Permanently delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
