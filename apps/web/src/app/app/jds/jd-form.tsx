'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createJdAction } from './actions';
import { cn } from '@/lib/cn';

type Mode = 'paste' | 'url';

export function JdForm() {
  const [mode, setMode] = useState<Mode>('paste');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData();
    fd.set('mode', mode);
    fd.set('company', company);
    fd.set('role', role);
    if (mode === 'paste') fd.set('body', body);
    else fd.set('url', url);
    const r = await createJdAction(fd);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error ?? 'failed');
      return;
    }
    setBody('');
    setUrl('');
    setCompany('');
    setRole('');
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2 text-xs">
        <ModeButton active={mode === 'paste'} onClick={() => setMode('paste')}>
          Paste text
        </ModeButton>
        <ModeButton active={mode === 'url'} onClick={() => setMode('url')}>
          From URL
        </ModeButton>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-ink-700">
          Company (optional)
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Razorpay"
            className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm"
            disabled={submitting}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-700">
          Role (optional)
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Senior SWE, Payments"
            className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm"
            disabled={submitting}
          />
        </label>
      </div>

      {mode === 'paste' ? (
        <label className="flex flex-col gap-1 text-sm text-ink-700">
          JD text
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm font-mono"
            placeholder="Paste the job description here…"
            required
            disabled={submitting}
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm text-ink-700">
          URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://jobs.example.com/senior-swe-payments"
            required
            disabled={submitting}
            className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm"
          />
          <span className="text-xs text-ink-500">
            Works best on Lever / Greenhouse / Ashby posts. LinkedIn often returns empty bodies —
            paste manually there.
          </span>
        </label>
      )}

      <button
        type="submit"
        disabled={submitting || (mode === 'paste' ? !body : !url)}
        className={cn(
          'self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition',
          'hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {submitting ? (mode === 'url' ? 'Fetching…' : 'Saving…') : 'Save JD'}
      </button>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </form>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700'
          : 'border-ink-100 bg-white text-ink-500 hover:bg-ink-50',
      )}
    >
      {children}
    </button>
  );
}
