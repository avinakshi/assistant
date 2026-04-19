import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LiveSessionTimeline, type TimelineEvent } from './timeline';
import { modeLabel } from '@/lib/sessions/aggregate';

export const dynamic = 'force-dynamic';

interface SessionRow {
  id: string;
  kind: 'live' | 'practice';
  mode: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  persist_transcripts: boolean;
  llm_choice: string;
}

interface EventRow {
  kind: string;
  payload: Record<string, unknown>;
  ts: string;
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: session }, { data: events }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, kind, mode, started_at, ended_at, duration_s, persist_transcripts, llm_choice')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('session_events')
      .select('kind, payload, ts')
      .eq('session_id', id)
      .order('ts', { ascending: true }),
  ]);

  if (!session) notFound();
  const s = session as SessionRow;

  // Practice sessions have their own rich viewer; route there for consistency.
  if (s.kind === 'practice') {
    // Using a raw Location header avoids a flash of this page's skeleton.
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-ink-500">
          This is a practice session.{' '}
          <Link href={`/app/practice/${s.id}`} className="text-brand-600 hover:underline">
            Open practice viewer \u2192
          </Link>
        </p>
      </div>
    );
  }

  const timelineEvents: TimelineEvent[] = ((events as EventRow[] | null) ?? []).map((e) => ({
    kind: e.kind,
    payload: e.payload,
    ts: e.ts,
  }));

  const durationLine = s.duration_s
    ? `${Math.max(1, Math.round(s.duration_s / 60))} min`
    : 'in progress';

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-ink-500">Live session</div>
          <h1 className="mt-0.5 text-xl font-semibold">{modeLabel(s.mode)}</h1>
          <div className="mt-1 text-xs text-ink-500">
            {new Date(s.started_at).toLocaleString()} \u00b7 {durationLine} \u00b7 {s.llm_choice}
          </div>
        </div>
        <Link
          href="/app/sessions"
          className="text-xs text-ink-500 hover:text-ink-900 hover:underline"
        >
          \u2190 All sessions
        </Link>
      </div>

      {!s.persist_transcripts && timelineEvents.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-6 text-sm text-ink-700">
          <div className="font-medium text-ink-900">No transcript saved for this session.</div>
          <p className="mt-2 text-ink-500">
            Transcript persistence was off when the session ran. The session row is here for
            the usage meter; there\u2019s nothing more to review.
          </p>
        </div>
      ) : timelineEvents.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-6 text-sm text-ink-500">
          No events recorded yet. {s.ended_at ? 'The session ended silently.' : 'Session is still running.'}
        </div>
      ) : (
        <LiveSessionTimeline events={timelineEvents} />
      )}
    </div>
  );
}
