import { describe, it, expect } from 'vitest';
import { computeStats, type SessionRow, type SummaryRow } from './aggregate';

const NOW = new Date('2026-04-18T12:00:00Z');
const DAY = 24 * 60 * 60 * 1_000;

function sess(over: Partial<SessionRow>): SessionRow {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'practice',
    mode: 'behavioral',
    started_at: new Date(NOW.getTime() - DAY).toISOString(),
    ended_at: null,
    duration_s: null,
    ...over,
  };
}

describe('computeStats', () => {
  it('returns an all-zero-ish snapshot on empty inputs', () => {
    const s = computeStats([], [], NOW);
    expect(s.weeklyCount).toBe(0);
    expect(s.scoredPracticeCount).toBe(0);
    expect(s.avgOverall).toBeNull();
    expect(s.weakestAxis).toBeNull();
    expect(s.weeklyMinutes).toBe(0);
  });

  it('counts weekly sessions by started_at within 7 days', () => {
    const rows = [
      sess({ started_at: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
      sess({ started_at: new Date(NOW.getTime() - 6 * DAY).toISOString() }),
      sess({ started_at: new Date(NOW.getTime() - 8 * DAY).toISOString() }), // outside
    ];
    expect(computeStats(rows, [], NOW).weeklyCount).toBe(2);
  });

  it('sums weekly minutes from duration_s', () => {
    const rows = [
      sess({ duration_s: 120 }),
      sess({ duration_s: 180 }),
      sess({ duration_s: null }), // ignored
    ];
    expect(computeStats(rows, [], NOW).weeklyMinutes).toBe(5);
  });

  it('ignores live-session scores (only practice contributes to overall)', () => {
    const rows = [
      sess({ id: 'a', kind: 'live' }),
      sess({ id: 'b', kind: 'practice' }),
    ];
    const summaries: SummaryRow[] = [
      { session_id: 'a', scores: { communication: 5, specificity: 5, structure: 5, relevance: 5 } },
      { session_id: 'b', scores: { communication: 2, specificity: 2, structure: 2, relevance: 2 } },
    ];
    const s = computeStats(rows, summaries, NOW);
    expect(s.scoredPracticeCount).toBe(1);
    expect(s.avgOverall).toBe(2);
  });

  it('takes overall as the mean of per-axis averages', () => {
    const rows = [
      sess({ id: 'a' }),
      sess({ id: 'b' }),
    ];
    const summaries: SummaryRow[] = [
      { session_id: 'a', scores: { communication: 4, specificity: 2, structure: 3, relevance: 5 } },
      { session_id: 'b', scores: { communication: 2, specificity: 4, structure: 3, relevance: 1 } },
    ];
    const s = computeStats(rows, summaries, NOW);
    // per-axis averages: comm 3, spec 3, struct 3, rel 3 → overall 3
    expect(s.avgOverall).toBe(3);
  });

  it('identifies the weakest axis by per-axis average', () => {
    const rows = [sess({ id: 'a' })];
    const summaries: SummaryRow[] = [
      { session_id: 'a', scores: { communication: 4, specificity: 1, structure: 3, relevance: 5 } },
    ];
    expect(computeStats(rows, summaries, NOW).weakestAxis).toBe('specificity');
  });

  it('leaves weakestAxis null when no summaries exist', () => {
    expect(computeStats([sess({})], [], NOW).weakestAxis).toBeNull();
  });

  it('skips non-number score fields gracefully', () => {
    const rows = [sess({ id: 'a' })];
    const summaries: SummaryRow[] = [
      {
        session_id: 'a',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        scores: { communication: 'bogus' as unknown as number, specificity: 2, structure: 2, relevance: 2 },
      },
    ];
    const s = computeStats(rows, summaries, NOW);
    // Communication dropped; overall is mean of {spec,struct,rel} = 2.
    expect(s.avgOverall).toBe(2);
    expect(s.weakestAxis).not.toBe('communication');
  });
});
