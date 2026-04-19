import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NewPracticeForm } from './new-practice-form';

export const dynamic = 'force-dynamic';

interface PracticeRow {
  id: string;
  mode: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
}

interface SummaryRow {
  session_id: string;
  scores: {
    communication?: number;
    specificity?: number;
    structure?: number;
    relevance?: number;
  };
}

export default async function PracticePage() {
  const supabase = await createClient();
  const [{ data: sessions }, { data: summaries }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, mode, started_at, ended_at, duration_s')
      .eq('kind', 'practice')
      .order('started_at', { ascending: false })
      .limit(20),
    supabase.from('session_summaries').select('session_id, scores'),
  ]);

  const summaryBySessionId = new Map<string, SummaryRow>();
  for (const s of (summaries ?? []) as SummaryRow[]) summaryBySessionId.set(s.session_id, s);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Practice</h1>
          <p className="mt-1 text-sm text-ink-500">
            Type back to an AI interviewer. Get a scorecard at the end. Great for warming
            up the day before a real round.
          </p>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-ink-100 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Start a new session
        </div>
        <NewPracticeForm />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
          Recent sessions
        </h2>
        {(sessions ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            No practice sessions yet. Start one above.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
            {(sessions ?? []).map((s) => (
              <PracticeRowItem
                key={(s as PracticeRow).id}
                row={s as PracticeRow}
                summary={summaryBySessionId.get((s as PracticeRow).id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PracticeRowItem({
  row,
  summary,
}: {
  row: PracticeRow;
  summary: SummaryRow | undefined;
}) {
  const status = row.ended_at ? 'ended' : 'in progress';
  const dur = row.duration_s ? `${Math.round(row.duration_s / 60)} min` : '—';
  const overall = summary?.scores
    ? (
        ((summary.scores.communication ?? 0) +
          (summary.scores.specificity ?? 0) +
          (summary.scores.structure ?? 0) +
          (summary.scores.relevance ?? 0)) /
        4
      ).toFixed(1)
    : null;
  return (
    <li className="p-4">
      <Link href={`/app/practice/${row.id}`} className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-900">
            {labelForMode(row.mode)} · {new Date(row.started_at).toLocaleString()}
          </div>
          <div className="mt-0.5 text-xs text-ink-500">
            {status} · {dur} {overall ? `· overall ${overall}/5` : ''}
          </div>
        </div>
        <span className="text-xs text-brand-600">Open →</span>
      </Link>
    </li>
  );
}

function labelForMode(m: string): string {
  switch (m) {
    case 'behavioral':
      return 'Behavioral';
    case 'coding':
      return 'Coding';
    case 'system_design':
      return 'System design';
    default:
      return m;
  }
}
