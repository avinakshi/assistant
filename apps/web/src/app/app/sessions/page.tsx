import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import {
  axisLabel,
  computeStats,
  type SessionRow,
  type SummaryRow,
} from '@/lib/sessions/aggregate';
import { SessionRowItem } from './session-row';

export const dynamic = 'force-dynamic';

export default async function SessionsPage() {
  const supabase = await createClient();
  const [{ data: sessionsData }, { data: summariesData }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, kind, mode, started_at, ended_at, duration_s')
      .order('started_at', { ascending: false })
      .limit(100),
    supabase.from('session_summaries').select('session_id, scores'),
  ]);

  const sessions = (sessionsData ?? []) as SessionRow[];
  const summaries = (summariesData ?? []) as SummaryRow[];
  const summaryById = new Map(summaries.map((s) => [s.session_id, s]));
  const stats = computeStats(sessions, summaries);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sessions</h1>
          <p className="mt-1 text-sm text-ink-500">
            Every live interview + practice session you’ve run. Practice sessions open
            into the chat transcript; live sessions show meta-data only (turn-by-turn
            persistence lands in Phase 9).
          </p>
        </div>
        <Link
          href="/app/practice"
          className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Start practice
        </Link>
      </div>

      <StatsCard stats={stats} />

      {sessions.length === 0 ? (
        <div className="mt-6 rounded-xl border border-ink-100 bg-white p-6 text-sm text-ink-500">
          No sessions yet. Kick off a practice session above, or run a live round from the
          desktop app.
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
          {sessions.map((s) => (
            <SessionRowItem key={s.id} row={s} summary={summaryById.get(s.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatsCard({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const avg = stats.avgOverall !== null ? stats.avgOverall.toFixed(1) : '—';
  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-4">
      <Stat label="Sessions, 7 days" value={`${stats.weeklyCount}`} />
      <Stat label="Minutes, 7 days" value={`${stats.weeklyMinutes}`} />
      <Stat label="Scored practices" value={`${stats.scoredPracticeCount}`} />
      <Stat
        label="Overall avg"
        value={avg}
        footer={
          stats.weakestAxis
            ? `Focus: ${axisLabel(stats.weakestAxis)}`
            : 'No scored practices yet'
        }
      />
    </section>
  );
}

function Stat({
  label,
  value,
  footer,
}: {
  label: string;
  value: string;
  footer?: string;
}) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink-900">{value}</div>
      {footer && <div className="mt-1 text-xs text-ink-500">{footer}</div>}
    </div>
  );
}
