'use client';

import { useState } from 'react';
import {
  exportLiveTranscriptMarkdown,
  type LiveSessionExportInput,
} from '@/lib/sessions/transcript';

type CopyState = 'idle' | 'copied' | 'error';

/**
 * Live-session transcript export. Mirrors /app/practice/[id]'s ExportButton but wires
 * to exportLiveTranscriptMarkdown. Serialized input is cheap to rebuild per render so
 * we don't bother memoizing.
 */
interface Props {
  input: Omit<LiveSessionExportInput, 'startedAt' | 'endedAt'> & {
    readonly startedAt: string;
    readonly endedAt?: string;
  };
}

export function CopyLiveButton({ input }: Props) {
  const [state, setState] = useState<CopyState>('idle');
  const [revealed, setRevealed] = useState(false);

  const md = exportLiveTranscriptMarkdown({
    mode: input.mode,
    startedAt: new Date(input.startedAt),
    ...(input.endedAt ? { endedAt: new Date(input.endedAt) } : {}),
    ...(input.llmChoice ? { llmChoice: input.llmChoice } : {}),
    events: input.events,
    ...(input.topics ? { topics: input.topics } : {}),
    ...(input.highlights ? { highlights: input.highlights } : {}),
    ...(input.improvements ? { improvements: input.improvements } : {}),
  });

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setState('copied');
      setTimeout(() => setState('idle'), 2_000);
    } catch {
      setState('error');
      setRevealed(true);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-ink-100 bg-white p-4">
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
          aria-label="Live session transcript markdown"
          rows={Math.min(20, md.split('\n').length + 1)}
          className="mt-3 w-full resize-y rounded-md border border-ink-100 bg-ink-50 p-3 font-mono text-xs text-ink-700"
        />
      )}
    </div>
  );
}
