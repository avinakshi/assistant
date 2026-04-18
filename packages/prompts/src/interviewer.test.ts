import { describe, it, expect } from 'vitest';
import {
  buildOpeningPrompt,
  buildTurnPrompt,
  buildFinalizePrompt,
} from './interviewer';

describe('buildOpeningPrompt', () => {
  it('includes mode-specific direction', () => {
    expect(buildOpeningPrompt('behavioral')).toMatch(/STAR pattern/);
    expect(buildOpeningPrompt('coding')).toMatch(/algorithm|data-structure/);
    expect(buildOpeningPrompt('system_design')).toMatch(/system-design|scale assumptions/);
  });

  it('requires a JSON-only response', () => {
    const p = buildOpeningPrompt('behavioral');
    expect(p).toMatch(/Return ONLY the JSON object/);
    expect(p).toMatch(/"question"/);
  });

  it('threads role + company when provided', () => {
    const p = buildOpeningPrompt('behavioral', { role: 'Senior SRE', company: 'Stripe' });
    expect(p).toMatch(/Senior SRE/);
    expect(p).toMatch(/Stripe/);
  });

  it('truncates long resume + JD context to 2000 chars each', () => {
    const huge = 'x'.repeat(10_000);
    const p = buildOpeningPrompt('behavioral', { resumeText: huge, jdText: huge });
    // Each occurrence of "xxxx...x" should be ≤2000 x's
    const matches = p.match(/x{2001,}/);
    expect(matches).toBeNull();
  });
});

describe('buildTurnPrompt', () => {
  const base = {
    mode: 'behavioral' as const,
    history: [{ question: 'Tell me about yourself.', answer: 'I led a team of 5.' }],
    latestAnswer: 'I led a team of 5.',
    questionsAskedSoFar: 1,
  };

  it('announces questions remaining so the LLM knows when to stop', () => {
    const p = buildTurnPrompt({ ...base, ctx: { maxQuestions: 3 } });
    expect(p).toMatch(/Questions remaining after this turn: 2/);
  });

  it('asks for a follow-up when remaining > 0', () => {
    const p = buildTurnPrompt({ ...base, ctx: { maxQuestions: 3 } });
    expect(p).toMatch(/ONE follow-up question/);
  });

  it('asks for null nextQuestion when no remaining slots', () => {
    const p = buildTurnPrompt({ ...base, ctx: { maxQuestions: 1 } });
    expect(p).toMatch(/return null for nextQuestion/);
  });

  it('embeds the transcript so the LLM has context', () => {
    const p = buildTurnPrompt({
      ...base,
      history: [
        { question: 'First?', answer: 'A1' },
        { question: 'Second?', answer: 'A2' },
      ],
      questionsAskedSoFar: 2,
    });
    expect(p).toMatch(/Q1: First\?/);
    expect(p).toMatch(/A2: A2/);
  });

  it('specifies the four score axes', () => {
    const p = buildTurnPrompt(base);
    expect(p).toMatch(/communication/);
    expect(p).toMatch(/specificity/);
    expect(p).toMatch(/structure/);
    expect(p).toMatch(/relevance/);
  });
});

describe('buildFinalizePrompt', () => {
  it('embeds the full transcript', () => {
    const p = buildFinalizePrompt({
      mode: 'coding',
      history: [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q2', answer: 'A2' },
      ],
      turnScores: [],
    });
    expect(p).toMatch(/Q1: Q1/);
    expect(p).toMatch(/A2: A2/);
  });

  it('notes empty-transcript case for honesty', () => {
    const p = buildFinalizePrompt({
      mode: 'behavioral',
      history: [],
      turnScores: [],
    });
    expect(p).toMatch(/No turns happened/);
  });

  it('asks for scores + highlights + improvements', () => {
    const p = buildFinalizePrompt({
      mode: 'behavioral',
      history: [{ question: 'Q', answer: 'A' }],
      turnScores: [],
    });
    expect(p).toMatch(/scores/);
    expect(p).toMatch(/highlights/);
    expect(p).toMatch(/improvements/);
  });
});
