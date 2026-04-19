'use client';

import { useState, useTransition } from 'react';
import { setPersistTranscriptsDefault } from './actions';

/**
 * Two-state toggle for profiles.persist_transcripts_default. The desktop reads this via
 * a follow-up api endpoint — for now the column is the source of truth and the desktop
 * still hardcodes true on startSession. Flipping the toggle silently persists; no Save
 * button because there's only one field.
 */
export function PersistTranscriptsToggle({ initial }: { initial: boolean }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (next: boolean) => {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(() => {
      void setPersistTranscriptsDefault(next).then((r) => {
        if (!r.ok) {
          setError(r.error ?? 'failed');
          setValue(prev);
        }
      });
    });
  };

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-900">Save live session transcripts</div>
          <p className="mt-1 text-xs text-ink-500">
            When on, live interview transcripts + AI suggestions are saved for review at
            /app/sessions. You can delete any session after the fact. When off, only usage
            minutes are recorded.
          </p>
        </div>
        <button
          type="button"
          onClick={() => change(!value)}
          disabled={pending}
          role="switch"
          aria-checked={value}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            value ? 'bg-brand-600' : 'bg-ink-100'
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              value ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}
      <div className="mt-3 text-[11px] text-ink-500">
        Desktop app currently overrides this on every session (hardcoded on). The toggle
        here prepares the way for a future update that honors your preference.
      </div>
    </div>
  );
}
