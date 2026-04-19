import { describe, it, expect } from 'vitest';
import { mergeOcrTexts } from './session-orchestrator';

describe('mergeOcrTexts', () => {
  it('returns next when prev is empty', () => {
    expect(mergeOcrTexts('', 'Find the longest substring.')).toBe('Find the longest substring.');
  });

  it('appends new lines from next and keeps order', () => {
    const prev = 'Problem:\nGiven an array of integers.';
    const next = 'Return the sum.\nConstraints: 1 <= n <= 1000';
    const out = mergeOcrTexts(prev, next);
    expect(out).toBe(
      'Problem:\nGiven an array of integers.\nReturn the sum.\nConstraints: 1 <= n <= 1000',
    );
  });

  it('de-duplicates lines present in both (case + punctuation normalized)', () => {
    const prev = 'Find the longest substring.\nExamples:';
    const next = 'find the longest substring\nConstraint: n <= 10^5';
    const out = mergeOcrTexts(prev, next);
    // Line appears once, not twice.
    expect(out.match(/longest substring/gi)?.length).toBe(1);
    expect(out).toContain('Constraint');
  });

  it('drops very short chrome lines (single chars, short buttons)', () => {
    // Lines shorter than 4 chars are treated as noise (page numbers, "×", "Run", nav
    // arrows). Longer button text like "Submit" survives because it could be part of
    // the actual problem statement ("Submit your solution via…"). Dedup still kicks
    // in if Submit appears in both screenshots.
    const prev = 'Problem: compute sum.';
    const next = 'Run\n1\n×\nReturn the sum.';
    const out = mergeOcrTexts(prev, next);
    expect(out).not.toContain('Run');
    expect(out).not.toContain('×');
    expect(out.split('\n')).not.toContain('1');
    expect(out).toContain('Return the sum.');
  });

  it('handles whitespace-only + empty lines', () => {
    const prev = 'Hello.\n\n  \n';
    const next = '\nWorld.\n';
    expect(mergeOcrTexts(prev, next)).toBe('Hello.\nWorld.');
  });

  it('preserves line order from prev when both sides have the same line', () => {
    const prev = 'A long line.\nMedium line.';
    const next = 'Medium line.\nNew trailing line here.';
    const out = mergeOcrTexts(prev, next);
    const lines = out.split('\n');
    expect(lines).toEqual(['A long line.', 'Medium line.', 'New trailing line here.']);
  });
});
