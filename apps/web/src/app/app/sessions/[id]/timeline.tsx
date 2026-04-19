'use client';

import { useMemo, useState } from 'react';

export interface TimelineEvent {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly ts: string;
}

/**
 * Renders a live-session's session_events rows as a chronological timeline.
 *
 * Event kinds we know about today (all others fall through as raw JSON chips so we see
 * them while iterating):
 *   - `transcript` — the interviewer's speech recognized by Deepgram. If `isQuestion`,
 *     the card is tagged as a question and the subsequent `answer` is paired visually.
 *   - `answer`     — the LLM's streamed answer, persisted in full after the stream ends.
 *     Carries `question`, `answer`, `provider`, `mode`, `latencyMs`.
 *   - `ocr`        — OCR result from a screenshot. Carries `title`, `site`, `difficulty`.
 */
interface Props {
  events: readonly TimelineEvent[];
}

export interface GroupedItem {
  readonly ev: TimelineEvent;
  readonly pairedAnswer?: TimelineEvent;
}

export function groupEvents(events: readonly TimelineEvent[]): GroupedItem[] {
  // Pair a `transcript` with isQuestion=true with the nearest subsequent `answer`, so
  // they render together. Non-question transcripts and unpaired answers render solo.
  const out: GroupedItem[] = [];
  const used = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    if (used.has(i)) continue;
    const ev = events[i]!;
    if (ev.kind === 'transcript' && ev.payload['isQuestion'] === true) {
      // Find the next `answer` event where payload.question matches (or just the next).
      let pair: TimelineEvent | undefined;
      for (let j = i + 1; j < events.length; j++) {
        if (used.has(j)) continue;
        const next = events[j]!;
        if (next.kind === 'answer') {
          pair = next;
          used.add(j);
          break;
        }
        if (next.kind === 'transcript' && next.payload['isQuestion'] === true) break;
      }
      out.push(pair ? { ev, pairedAnswer: pair } : { ev });
    } else {
      out.push({ ev });
    }
  }
  return out;
}

export function LiveSessionTimeline({ events }: Props) {
  const items = useMemo(() => groupEvents(events), [events]);
  const [hideChatter, setHideChatter] = useState(false);
  const visibleItems = hideChatter
    ? items.filter(
        (i) =>
          !(i.ev.kind === 'transcript' && i.ev.payload['isQuestion'] !== true),
      )
    : items;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-ink-500">
          {events.length} events · {items.filter((i) => i.pairedAnswer).length} Q/A pairs
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-500">
          <input
            type="checkbox"
            checked={hideChatter}
            onChange={(e) => setHideChatter(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
          />
          Hide non-question chatter
        </label>
      </div>
      <ol className="flex flex-col gap-4">
        {visibleItems.map((item, idx) => (
          <li key={idx}>
            <TimelineRow item={item} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function TimelineRow({ item }: { item: GroupedItem }) {
  const { ev, pairedAnswer } = item;
  switch (ev.kind) {
    case 'transcript':
      return <TranscriptCard ev={ev} pairedAnswer={pairedAnswer} />;
    case 'answer':
      // Unpaired answer — unusual, but render it.
      return <AnswerCard ev={ev} />;
    case 'ocr':
      return <OcrCard ev={ev} />;
    default:
      return <RawCard ev={ev} />;
  }
}

function TranscriptCard({
  ev,
  pairedAnswer,
}: {
  ev: TimelineEvent;
  pairedAnswer: TimelineEvent | undefined;
}) {
  const text = asString(ev.payload['text']);
  const isQuestion = ev.payload['isQuestion'] === true;
  // Diarize-mode payloads (Phase 13b) include `source`. Rows from older sessions don't,
  // so default to "interviewer" — matches the pre-diarize UX.
  const source =
    ev.payload['source'] === 'candidate' ? 'candidate' : 'interviewer';
  // Prefer the diarize label over the old isQuestion-based one when available: even a
  // non-question utterance from the candidate deserves the "You" tag, not "Interviewer".
  const hasSource = ev.payload['source'] === 'interviewer' || ev.payload['source'] === 'candidate';
  const label = hasSource
    ? source === 'candidate'
      ? 'You'
      : isQuestion
        ? 'Question'
        : 'Interviewer'
    : isQuestion
      ? 'Question'
      : 'Interviewer';
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`rounded-xl border p-4 ${
          isQuestion ? 'border-brand-100 bg-white' : 'border-ink-100 bg-white/60'
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${
              source === 'candidate'
                ? 'text-emerald-700'
                : isQuestion
                  ? 'text-brand-700'
                  : 'text-ink-500'
            }`}
          >
            {label}
          </span>
          <TimeBadge ts={ev.ts} />
        </div>
        <p className="mt-1 text-sm text-ink-900 whitespace-pre-wrap">{text}</p>
      </div>
      {pairedAnswer && <AnswerCard ev={pairedAnswer} paired />}
    </div>
  );
}

function AnswerCard({ ev, paired = false }: { ev: TimelineEvent; paired?: boolean }) {
  const answer = asString(ev.payload['answer']);
  const question = asString(ev.payload['question']);
  const provider = asString(ev.payload['provider']);
  const mode = asString(ev.payload['mode']);
  const latencyMs =
    typeof ev.payload['latencyMs'] === 'number' ? (ev.payload['latencyMs'] as number) : null;
  return (
    <div
      className={`rounded-xl border border-ink-100 p-4 ${
        paired ? 'ml-6 bg-ink-50/50' : 'bg-ink-50/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          AI suggested
        </span>
        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-700">
          {provider}
        </span>
        {mode && (
          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-700">{mode}</span>
        )}
        {latencyMs !== null && (
          <span className="text-[10px] text-ink-500">{latencyMs} ms first token</span>
        )}
        <TimeBadge ts={ev.ts} />
      </div>
      {!paired && question && (
        <p className="mt-2 text-xs italic text-ink-500">Re: {question}</p>
      )}
      <p className="mt-2 text-sm text-ink-900 whitespace-pre-wrap">{answer}</p>
    </div>
  );
}

function OcrCard({ ev }: { ev: TimelineEvent }) {
  const title = asString(ev.payload['title']);
  const site = asString(ev.payload['site']);
  const difficulty = asString(ev.payload['difficulty']);
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-800">
        Screenshot → OCR
        <TimeBadge ts={ev.ts} />
      </div>
      <div className="mt-1 text-sm text-ink-900">
        {title || '(untitled problem)'}{' '}
        <span className="text-xs text-ink-500">
          {site} {difficulty && `· ${difficulty}`}
        </span>
      </div>
    </div>
  );
}

function RawCard({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-3 text-xs">
      <div className="font-medium text-ink-700">
        {ev.kind} <TimeBadge ts={ev.ts} />
      </div>
      <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-ink-500">
        {JSON.stringify(ev.payload, null, 2)}
      </pre>
    </div>
  );
}

function TimeBadge({ ts }: { ts: string }) {
  const d = new Date(ts);
  return (
    <time className="text-[10px] text-ink-500" dateTime={ts}>
      {d.toLocaleTimeString()}
    </time>
  );
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
