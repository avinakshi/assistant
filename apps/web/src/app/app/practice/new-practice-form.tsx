'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startPracticeAction } from './actions';

const MODES = [
  { value: 'behavioral', label: 'Behavioral', hint: 'STAR stories, leadership, ownership' },
  { value: 'coding', label: 'Coding', hint: 'Narrated algorithmic questions' },
  { value: 'system_design', label: 'System design', hint: 'Design a real service end-to-end' },
] as const;

export function NewPracticeForm() {
  const router = useRouter();
  const [mode, setMode] = useState<string>('behavioral');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set('mode', mode);
    if (role.trim()) fd.set('role', role.trim());
    if (company.trim()) fd.set('company', company.trim());
    startTransition(() => {
      void startPracticeAction(fd).then((r) => {
        if (!r.ok || !r.sessionId) {
          setError(r.error ?? 'start failed');
          return;
        }
        router.push(`/app/practice/${r.sessionId}`);
      });
    });
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div>
        <div className="text-xs text-ink-500">Mode</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`flex flex-col items-start rounded-lg border p-3 text-left transition ${
                mode === m.value
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-ink-100 bg-white hover:bg-ink-50'
              }`}
            >
              <span className="text-sm font-medium text-ink-900">{m.label}</span>
              <span className="mt-1 text-xs text-ink-500">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          Target role (optional)
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Senior SRE"
            className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          Company (optional)
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Stripe"
            className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </label>
      </div>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Warming up\u2026' : 'Start practice'}
      </button>
    </div>
  );
}
