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
