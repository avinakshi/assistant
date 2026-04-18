'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPersonaAction } from './actions';

export function PersonaForm() {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !prompt) return;
    setSubmitting(true);
    setError(null);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('system_prompt', prompt);
    const r = await createPersonaAction(fd);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error ?? 'failed');
      return;
    }
    setName('');
    setPrompt('');
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-ink-700">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="SRE interviews — incident focus"
          required
          disabled={submitting}
          className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-700">
        System prompt (appended to the default pack)
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
          required
          disabled={submitting}
          className="rounded-md border border-ink-100 bg-white px-3 py-2 font-mono text-sm"
          placeholder="When asked about incidents, lead with timeline → blast radius → mitigation → root cause → follow-up. Prefer specific numbers (MTTR, customer impact)."
        />
      </label>
      <button
        type="submit"
        disabled={submitting || !name || !prompt}
        className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Save persona'}
      </button>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </form>
  );
}
