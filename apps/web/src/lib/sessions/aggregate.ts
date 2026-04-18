/**
 * Pure aggregation helpers for the /app/sessions overview. No DB access here — callers
 * fetch the rows, pass them in, and render whatever these functions return.
 *
 * Kept framework-free so it's trivially unit-testable.
 */

export type SessionKind = 'live' | 'practice';

export interface SessionRow {
  readonly id: string;
  readonly kind: SessionKind;
  readonly mode: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly duration_s: number | null;
}

export interface SummaryScores {
  readonly communication?: number;
  readonly specificity?: number;
  readonly structure?: number;
  readonly relevance?: number;
}

export interface SummaryRow {
  readonly session_id: string;
  readonly scores: SummaryScores;
}

export interface SessionStats {
  /** Count of sessions that started in the last 7×24h. */
  readonly weeklyCount: number;
  /** Count of PRACTICE sessions that have a summary row (i.e., completed with a score). */
  readonly scoredPracticeCount: number;
  /** Average overall score (0-5) across scored practices. null when none. */
  readonly avgOverall: number | null;
  /** The axis with the lowest average — useful for "focus on X next" suggestions. */
  readonly weakestAxis: keyof SummaryScores | null;
  /** Total live + practice minutes in the last 7×24h. */
  readonly weeklyMinutes: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

export function computeStats(
  sessions: readonly SessionRow[],
  summaries: readonly SummaryRow[],
  now: Date = new Date(),
): SessionStats {
  const cutoff = now.getTime() - WEEK_MS;
  const weekly = sessions.filter((s) => Date.parse(s.started_at) >= cutoff);
  const weeklyMinutes = Math.round(
    weekly.reduce((acc, s) => acc + (s.duration_s ?? 0), 0) / 60,
  );

  const summaryBySession = new Map<string, SummaryScores>();
  for (const s of summaries) summaryBySession.set(s.session_id, s.scores ?? {});

  // Gather per-axis averages across all scored PRACTICE sessions (not just the week —
  // trends over longer windows are more useful for the "weakest" signal).
  const totals: Record<keyof SummaryScores, { sum: number; n: number }> = {
    communication: { sum: 0, n: 0 },
    specificity: { sum: 0, n: 0 },
    structure: { sum: 0, n: 0 },
    relevance: { sum: 0, n: 0 },
  };
  let scored = 0;
  for (const s of sessions) {
    if (s.kind !== 'practice') continue;
    const scores = summaryBySession.get(s.id);
    if (!scores) continue;
    scored += 1;
    for (const axis of ['communication', 'specificity', 'structure', 'relevance'] as const) {
      const v = scores[axis];
      if (typeof v === 'number' && Number.isFinite(v)) {
        totals[axis].sum += v;
        totals[axis].n += 1;
      }
    }
  }

  // Overall = mean of the four axis averages (not the mean of raw points, which would
  // weight axes with more data disproportionately).
  const perAxisAvg: Record<keyof SummaryScores, number | null> = {
    communication: totals.communication.n > 0 ? totals.communication.sum / totals.communication.n : null,
    specificity: totals.specificity.n > 0 ? totals.specificity.sum / totals.specificity.n : null,
    structure: totals.structure.n > 0 ? totals.structure.sum / totals.structure.n : null,
    relevance: totals.relevance.n > 0 ? totals.relevance.sum / totals.relevance.n : null,
  };
  const definedAxes = Object.values(perAxisAvg).filter((v): v is number => v !== null);
  const avgOverall =
    definedAxes.length > 0
      ? definedAxes.reduce((a, b) => a + b, 0) / definedAxes.length
      : null;

  let weakestAxis: keyof SummaryScores | null = null;
  let weakestVal = Infinity;
  for (const [axis, v] of Object.entries(perAxisAvg) as [keyof SummaryScores, number | null][]) {
    if (v === null) continue;
    if (v < weakestVal) {
      weakestVal = v;
      weakestAxis = axis;
    }
  }

  return {
    weeklyCount: weekly.length,
    scoredPracticeCount: scored,
    avgOverall,
    weakestAxis,
    weeklyMinutes,
  };
}

export function axisLabel(axis: keyof SummaryScores): string {
  switch (axis) {
    case 'communication':
      return 'communication';
    case 'specificity':
      return 'specificity';
    case 'structure':
      return 'structure';
    case 'relevance':
      return 'relevance';
  }
}

export function modeLabel(mode: string): string {
  switch (mode) {
    case 'behavioral':
      return 'Behavioral';
    case 'coding':
      return 'Coding';
    case 'system_design':
      return 'System design';
    case 'auto':
      return 'Auto';
    default:
      return mode;
  }
}
