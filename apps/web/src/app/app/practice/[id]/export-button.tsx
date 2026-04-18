'use client';

import { useState } from 'react';
import { exportTranscriptMarkdown, type ExportInput } from '@/lib/sessions/transcript';

type CopyState = 'idle' | 'copied' | 'error';

/**
 * Copies the rendered markdown to clipboard. `navigator.clipboard.writeText` needs a
 * secure context (https or localhost). On failure we fall back to showing the markdown
 * in a textarea so the user can manually copy — never a dead button.
 */
export function ExportButton({ input }: { input: ExportInput }) {
  const [state, setState] = useState<CopyState>('idle');
  const [revealed, setRevealed] = useState(false);

  // Rebuild on every render — cheap since the input size is bounded (≤ 6 turns).
  const md = exportTranscriptMarkdown({ ...input, startedAt: new Date(input.startedAt) });

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setState('copied');
      setTimeout(() => setState('idle'), 2_000);
    } catch {
      // Clipboard blocked (non-secure context, permission denied, or old browser).
      setState('error');
      setRevealed(true);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Export transcript
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="rounded border border-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50"
          >
            {revealed ? 'Hide' : 'Show markdown'}
          </button>
          <button
            type="button"
            onClick={() => void onCopy()}
            className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            {state === 'copied' ? 'Copied \u2713' : 'Copy markdown'}
          </button>
        </div>
      </div>
      {state === 'error' && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Clipboard access blocked. The markdown is shown below so you can copy manually.
        </div>
      )}
      {revealed && (
        <textarea
          readOnly
          value={md}
          rows={Math.min(20, md.split('\n').length + 1)}
          className="mt-3 w-full resize-y rounded-md border border-ink-100 bg-ink-50 p-3 font-mono text-xs text-ink-700"
        />
      )}
    </div>
  );
}

export type { ExportInput };
