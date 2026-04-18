'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; msg: string };

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const params = useSearchParams();
  const next = params.get('next') ?? '/app';
  // Phase 6e: when the desktop app opens us with ?from=desktop&state=<nonce>, thread
  // those two params through the Supabase round-trip so the callback route knows to
  // redirect to ic://auth-callback?… instead of /app.
  const from = params.get('from');
  const state = params.get('state');
  const isDesktop = from === 'desktop' && typeof state === 'string' && state.length > 0;

  const buildCallbackUrl = () => {
    const u = new URL('/auth/callback', window.location.origin);
    u.searchParams.set('next', next);
    if (isDesktop) {
      u.searchParams.set('from', 'desktop');
      u.searchParams.set('state', state);
    }
    return u.toString();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || status.kind === 'sending') return;
    setStatus({ kind: 'sending' });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: buildCallbackUrl() },
    });
    if (error) setStatus({ kind: 'error', msg: error.message });
    else setStatus({ kind: 'sent' });
  };

  const onGoogle = async () => {
    setStatus({ kind: 'sending' });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: buildCallbackUrl() },
    });
    if (error) setStatus({ kind: 'error', msg: error.message });
  };

  if (status.kind === 'sent') {
    return (
      <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <div className="font-medium">Check your inbox</div>
        <div className="mt-1">
          We sent a login link to {email}.
          {isDesktop && ' Click it and you\u2019ll be returned to the Interview Copilot app.'}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-ink-700">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-ink-100 bg-white px-3 py-2 text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          placeholder="you@example.com"
        />
      </label>
      <button
        type="submit"
        disabled={status.kind === 'sending' || !email}
        className={cn(
          'rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition',
          'hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {status.kind === 'sending' ? 'Sending…' : 'Email me a login link'}
      </button>
      <div className="relative flex items-center justify-center py-1 text-xs text-ink-500">
        <div className="absolute inset-x-0 h-px bg-ink-100" />
        <span className="relative bg-white px-2">or</span>
      </div>
      <button
        type="button"
        onClick={onGoogle}
        disabled={status.kind === 'sending'}
        className="rounded-md border border-ink-100 bg-white px-4 py-2 text-sm text-ink-700 transition hover:bg-ink-50 disabled:opacity-50"
      >
        Continue with Google
      </button>
      {status.kind === 'error' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {status.msg}
        </div>
      )}
    </form>
  );
}
