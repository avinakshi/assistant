import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PracticeChat, type ChatEvent, type ChatSummary } from './practice-chat';

export const dynamic = 'force-dynamic';

interface SessionRow {
  id: string;
  mode: string;
  kind: string;
  ended_at: string | null;
  started_at: string;
}

interface EventRow {
  kind: string;
  payload: Record<string, unknown>;
  ts: string;
}

interface SummaryRow {
  scores: Record<string, number>;
  highlights: string[];
  improvements: string[];
  created_at: string;
}

export default async function PracticeSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: session }, { data: events }, { data: summary }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, mode, kind, ended_at, started_at')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('session_events')
      .select('kind, payload, ts')
      .eq('session_id', id)
      .order('ts', { ascending: true }),
    supabase
      .from('session_summaries')
      .select('scores, highlights, improvements, created_at')
      .eq('session_id', id)
      .maybeSingle(),
  ]);

  if (!session) notFound();
  const s = session as SessionRow;
  if (s.kind !== 'practice') notFound();

  const chatEvents: ChatEvent[] = ((events as EventRow[] | null) ?? []).map((e) => ({
    kind: e.kind,
    payload: e.payload,
    ts: e.ts,
  }));
  const summaryProp: ChatSummary | undefined = summary
    ? {
        scores: (summary as SummaryRow).scores ?? {},
        highlights: (summary as SummaryRow).highlights ?? [],
        improvements: (summary as SummaryRow).improvements ?? [],
      }
    : undefined;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4 text-xs text-ink-500">
        {labelForMode(s.mode)} \u00b7 started {new Date(s.started_at).toLocaleString()}
        {s.ended_at && ' \u00b7 ended ' + new Date(s.ended_at).toLocaleString()}
      </div>
      <PracticeChat
        sessionId={s.id}
        mode={s.mode}
        ended={!!s.ended_at}
        events={chatEvents}
        {...(summaryProp ? { summary: summaryProp } : {})}
      />
    </div>
  );
}

function labelForMode(m: string): string {
  switch (m) {
    case 'behavioral':
      return 'Behavioral practice';
    case 'coding':
      return 'Coding practice';
    case 'system_design':
      return 'System design practice';
    default:
      return 'Practice';
  }
}
