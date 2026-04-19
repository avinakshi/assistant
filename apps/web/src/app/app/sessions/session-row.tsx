'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteSessionAction } from './actions';
import { modeLabel, type SessionRow, type SummaryRow } from '@/lib/sessions/aggregate';

interface Props {
  row: SessionRow;
  summary: SummaryRow | undefined;
}

function overallScore(scores: SummaryRow['scores'] | undefined): number | null {
  if (!scores) return null;
  const vals = (['communication', 'specificity', 'structure', 'relevance'] as const)
    .map((k) => scores[k])
    .filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function SessionRowItem({ row, summary }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const overall = overallScore(summary?.scores);
  const status = row.ended_at ? 'ended' : 'in progress';
  const dur = row.duration_s ? `${Math.max(1, Math.round(row.duration_s / 60))} min` : '—';
  const href = row.kind === 'practice' ? `/app/practice/${row.id}` : `/app/sessions/${row.id}`;

  const del = () => {
    if (!window.confirm('Delete this session? Transcript + scorecard will be wiped.')) return;
    startTransition(() => {
      void deleteSessionAction(row.id).then((r) => {
        if (r.ok) router.refresh();
      });
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 p-4">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
            row.kind === 'practice'
              ? 'bg-brand-50 text-brand-700'
              : 'bg-ink-50 text-ink-700'
          }`}
        >
          {row.kind}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink-900">
            {modeLabel(row.mode)} · {new Date(row.started_at).toLocaleString()}
          </div>
          <div className="mt-0.5 text-xs text-ink-500">
            {status} · {dur}
            {overall !== null && ` · overall ${overall.toFixed(1)}/5`}
          </div>
        </div>
      </Link>
      <button
        type="button"
        onClick={del}
        disabled={pending}
        className="shrink-0 rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </button>
    </li>
  );
}
