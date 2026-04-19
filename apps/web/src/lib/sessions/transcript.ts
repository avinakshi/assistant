/**
 * Pure transcript-export helpers. Consumed by the review page's "Copy transcript" button.
 *
 * The markdown is deliberately plain: Q+A pairs, inline per-turn scores, trailing
 * summary block. Pastes legibly into Notion / Linear / email without any tweaks.
 */

export interface TurnForExport {
  readonly index: number;
  readonly question: string;
  readonly answer?: string;
  readonly feedback?: {
    readonly scores: Record<string, number>;
    readonly notes?: string;
  };
}

export interface SummaryForExport {
  readonly scores: Record<string, number>;
  readonly highlights: readonly string[];
  readonly improvements: readonly string[];
}

export interface ExportInput {
  readonly mode: string;
  readonly startedAt: Date;
  readonly turns: readonly TurnForExport[];
  readonly summary?: SummaryForExport;
}

const AXES = ['communication', 'specificity', 'structure', 'relevance'] as const;

function mean(scores: Record<string, number>): number {
  let sum = 0;
  let n = 0;
  for (const a of AXES) {
    const v = scores[a];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

export function exportTranscriptMarkdown(input: ExportInput): string {
  const lines: string[] = [];
  lines.push(`# Practice session — ${humanizeMode(input.mode)}`);
  lines.push(`_${input.startedAt.toISOString()}_`);
  lines.push('');

  for (const turn of input.turns) {
    lines.push(`## Q${turn.index + 1}`);
    lines.push(turn.question.trim());
    lines.push('');
    if (turn.answer) {
      lines.push('**Answer.** ' + turn.answer.trim());
      lines.push('');
    }
    if (turn.feedback) {
      const avg = mean(turn.feedback.scores).toFixed(1);
      const chips = AXES.map((a) => {
        const v = turn.feedback?.scores[a];
        return typeof v === 'number' ? `${a} ${v.toFixed(1)}` : null;
      })
        .filter((s): s is string => s !== null)
        .join(' · ');
      lines.push(`**Feedback** (avg ${avg}/5 — ${chips})`);
      if (turn.feedback.notes) lines.push(`> ${turn.feedback.notes.trim()}`);
      lines.push('');
    }
  }

  if (input.summary) {
    lines.push(`## Final review`);
    const avg = mean(input.summary.scores).toFixed(1);
    lines.push(`Overall **${avg}/5**`);
    for (const a of AXES) {
      const v = input.summary.scores[a];
      if (typeof v === 'number') lines.push(`- ${a}: ${v.toFixed(1)}`);
    }
    if (input.summary.highlights.length > 0) {
      lines.push('');
      lines.push('**Strengths**');
      for (const h of input.summary.highlights) lines.push(`- ${h}`);
    }
    if (input.summary.improvements.length > 0) {
      lines.push('');
      lines.push('**Work on**');
      for (const i of input.summary.improvements) lines.push(`- ${i}`);
    }
  }

  return lines.join('\n').trim() + '\n';
}

function humanizeMode(mode: string): string {
  switch (mode) {
    case 'behavioral':
      return 'Behavioral';
    case 'coding':
      return 'Coding';
    case 'system_design':
      return 'System design';
    default:
      return mode;
  }
}

// ---- Live session export --------------------------------------------------

export interface LiveEventForExport {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly ts: string;
}

export interface LiveSessionExportInput {
  readonly mode: string;
  readonly startedAt: Date;
  readonly endedAt?: Date;
  readonly llmChoice?: string;
  readonly events: readonly LiveEventForExport[];
  readonly topics?: readonly string[];
  readonly highlights?: readonly string[];
  readonly improvements?: readonly string[];
}

/**
 * Markdown export of a live session. Mirrors the practice exporter's shape but without
 * the per-turn scoring chips (live sessions don't score the candidate — see Phase 9b's
 * live-recap rationale in packages/prompts/src/live-recap.ts).
 */
export function exportLiveTranscriptMarkdown(input: LiveSessionExportInput): string {
  const lines: string[] = [];
  lines.push(`# Live interview — ${humanizeMode(input.mode)}`);
  lines.push(`_${input.startedAt.toISOString()}_`);
  if (input.endedAt) lines.push(`_ended ${input.endedAt.toISOString()}_`);
  if (input.llmChoice) lines.push(`_llm: ${input.llmChoice}_`);
  lines.push('');

  if (input.topics && input.topics.length > 0) {
    lines.push('## Topics covered');
    for (const t of input.topics) lines.push(`- ${t}`);
    lines.push('');
  }
  if (input.highlights && input.highlights.length > 0) {
    lines.push('## Highlights');
    for (const h of input.highlights) lines.push(`- ${h}`);
    lines.push('');
  }
  if (input.improvements && input.improvements.length > 0) {
    lines.push('## Prep for next time');
    for (const i of input.improvements) lines.push(`- ${i}`);
    lines.push('');
  }

  lines.push('## Transcript');

  // Pair question transcripts with the nearest following `answer` event, same rule as
  // the timeline UI. Everything else goes through in-order.
  const events = input.events;
  const used = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    if (used.has(i)) continue;
    const ev = events[i]!;
    if (ev.kind === 'transcript' && ev.payload['isQuestion'] === true) {
      const qText =
        typeof ev.payload['text'] === 'string' ? (ev.payload['text'] as string) : '';
      lines.push('', `**Q.** ${qText}`);
      for (let j = i + 1; j < events.length; j++) {
        if (used.has(j)) continue;
        const next = events[j]!;
        if (next.kind === 'answer') {
          const answer =
            typeof next.payload['answer'] === 'string' ? (next.payload['answer'] as string) : '';
          lines.push('', `**AI suggestion.** ${answer}`);
          used.add(j);
          break;
        }
        if (next.kind === 'transcript' && next.payload['isQuestion'] === true) break;
      }
    } else if (ev.kind === 'transcript') {
      const text =
        typeof ev.payload['text'] === 'string' ? (ev.payload['text'] as string) : '';
      if (text.trim().length > 0) lines.push('', `> ${text}`);
    } else if (ev.kind === 'ocr') {
      const title =
        typeof ev.payload['title'] === 'string' ? (ev.payload['title'] as string) : '';
      const site =
        typeof ev.payload['site'] === 'string' ? (ev.payload['site'] as string) : '';
      lines.push('', `*[screenshot] ${title || '(untitled)'}${site ? ` — ${site}` : ''}*`);
    } else if (ev.kind === 'answer') {
      // Unpaired answer (no preceding question) — fall through.
      const answer =
        typeof ev.payload['answer'] === 'string' ? (ev.payload['answer'] as string) : '';
      lines.push('', `**AI suggestion.** ${answer}`);
    }
  }

  return lines.join('\n').trim() + '\n';
}
