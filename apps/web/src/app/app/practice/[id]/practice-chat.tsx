'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { answerPracticeAction, endPracticeAction } from '../actions';

export interface ChatEvent {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly ts: string;
}

export interface ChatSummary {
  readonly scores: Record<string, number>;
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
}

/**
 * Renders the practice session as an alternating Q/A timeline with inline feedback
 * chips. Input box at the bottom; disabled once the session ends.
 *
 * The timeline is derived purely from the session_events rows we loaded in the server
 * component — we don't re-fetch on every turn. Server actions call revalidatePath, so
 * Next.js re-renders this component with fresh events.
 */
interface Props {
  sessionId: string;
  mode: string;
  ended: boolean;
  events: readonly ChatEvent[];
  summary?: ChatSummary;
}

interface Turn {
  index: number;
  question: string;
  answer?: string;
  feedback?: { scores: Record<string, number>; notes: string };
}

function toTurns(events: readonly ChatEvent[]): Turn[] {
  const byIndex = new Map<number, Turn>();
  for (const ev of events) {
    const idx = typeof ev.payload['index'] === 'number' ? (ev.payload['index'] as number) : 0;
    const existing = byIndex.get(idx) ?? { index: idx, question: '' };
    if (ev.kind === 'interviewer_question') {
      existing.question = typeof ev.payload['text'] === 'string' ? (ev.payload['text'] as string) : '';
    } else if (ev.kind === 'candidate_answer') {
      existing.answer = typeof ev.payload['text'] === 'string' ? (ev.payload['text'] as string) : '';
    } else if (ev.kind === 'interviewer_feedback') {
      const scores = (ev.payload['scores'] as Record<string, number>) ?? {};
      const notes = typeof ev.payload['notes'] === 'string' ? (ev.payload['notes'] as string) : '';
      existing.feedback = { scores, notes };
    }
    byIndex.set(idx, existing);
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

export function PracticeChat(props: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const turns = useMemo(() => toTurns(props.events), [props.events]);
  const lastTurn = turns[turns.length - 1];
  const awaitingAnswer = !props.ended && !!lastTurn && lastTurn.answer === undefined;

  const sendAnswer = () => {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    setDraft('');
    startTransition(() => {
      void answerPracticeAction(props.sessionId, text).then((r) => {
        if (!r.ok) setError(r.error ?? 'turn failed');
        router.refresh();
      });
    });
  };

  const endNow = () => {
    setError(null);
    startTransition(() => {
      void endPracticeAction(props.sessionId).then((r) => {
        if (!r.ok) setError(r.error ?? 'end failed');
        router.refresh();
      });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-5">
        {turns.map((t) => (
          <TurnCard key={t.index} turn={t} />
        ))}
      </ol>

      {props.summary && <SummaryCard summary={props.summary} />}

      {awaitingAnswer && (
        <div className="sticky bottom-0 rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your answer. Keep it specific — STAR format for behavioral."
            rows={5}
            disabled={pending}
            className="w-full resize-y rounded-md border border-ink-100 bg-white p-3 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-ink-500">
              {draft.length > 0 ? `${draft.length} chars` : 'Ctrl/Cmd + Enter to send'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={endNow}
                disabled={pending}
                className="rounded-md border border-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              >
                End + review
              </button>
              <button
                type="button"
                onClick={sendAnswer}
                disabled={pending || draft.trim().length === 0}
                className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Thinking\u2026' : 'Submit answer'}
              </button>
            </div>
          </div>
          {error && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {error}
            </div>
          )}
        </div>
      )}

      {!props.ended && !awaitingAnswer && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Waiting for the interviewer\u2019s next question\u2026
        </div>
      )}

      {props.ended && !props.summary && (
        <div className="rounded-md border border-ink-100 bg-white p-3 text-sm text-ink-700">
          Generating your review\u2026
        </div>
      )}
    </div>
  );
}

function TurnCard({ turn }: { turn: Turn }) {
  return (
    <li className="flex flex-col gap-3">
      <div className="rounded-xl border border-ink-100 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Interviewer
        </div>
        <p className="mt-1 text-sm text-ink-900 whitespace-pre-wrap">{turn.question}</p>
      </div>
      {turn.answer !== undefined && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-700">You</div>
          <p className="mt-1 text-sm text-ink-900 whitespace-pre-wrap">{turn.answer}</p>
        </div>
      )}
      {turn.feedback && <FeedbackChip feedback={turn.feedback} />}
    </li>
  );
}

function FeedbackChip({ feedback }: { feedback: NonNullable<Turn['feedback']> }) {
  const { scores, notes } = feedback;
  const avg = (
    ((scores['communication'] ?? 0) +
      (scores['specificity'] ?? 0) +
      (scores['structure'] ?? 0) +
      (scores['relevance'] ?? 0)) /
    4
  ).toFixed(1);
  return (
    <div className="ml-6 rounded-md border border-ink-100 bg-white p-3 text-xs text-ink-700">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
        <span className="rounded bg-ink-50 px-2 py-0.5 text-ink-700">Score {avg}/5</span>
        <ScorePill label="comm" v={scores['communication']} />
        <ScorePill label="specific" v={scores['specificity']} />
        <ScorePill label="structure" v={scores['structure']} />
        <ScorePill label="relevant" v={scores['relevance']} />
      </div>
      {notes && <p className="mt-2 text-ink-700">{notes}</p>}
    </div>
  );
}

function ScorePill({ label, v }: { label: string; v: number | undefined }) {
  const n = typeof v === 'number' ? v : 0;
  const color = n >= 4 ? 'bg-emerald-50 text-emerald-700' : n >= 2.5 ? 'bg-ink-50 text-ink-700' : 'bg-amber-50 text-amber-800';
  return (
    <span className={`rounded px-1.5 py-0.5 ${color}`}>
      {label} {n.toFixed(1)}
    </span>
  );
}

function SummaryCard({ summary }: { summary: ChatSummary }) {
  const avg = (
    ((summary.scores['communication'] ?? 0) +
      (summary.scores['specificity'] ?? 0) +
      (summary.scores['structure'] ?? 0) +
      (summary.scores['relevance'] ?? 0)) /
    4
  ).toFixed(1);
  return (
    <div className="rounded-xl border border-brand-100 bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
        Final review
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <div className="text-3xl font-semibold text-ink-900">{avg}</div>
        <div className="text-sm text-ink-500">overall out of 5</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <ScorePill label="comm" v={summary.scores['communication']} />
        <ScorePill label="specific" v={summary.scores['specificity']} />
        <ScorePill label="structure" v={summary.scores['structure']} />
        <ScorePill label="relevant" v={summary.scores['relevance']} />
      </div>
      {summary.highlights.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Strengths
          </div>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
            {summary.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}
      {summary.improvements.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-700">
            Work on
          </div>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
            {summary.improvements.map((i, idx) => (
              <li key={idx}>{i}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
