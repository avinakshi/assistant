import { describe, it, expect } from 'vitest';
import { buildUserMessage } from './context-render';
import type { AnswerContext } from './provider';

const MIN: AnswerContext = { question: 'Tell me about yourself.' };

describe('buildUserMessage', () => {
  it('wraps the question in <question> and defaults language to en', () => {
    const out = buildUserMessage(MIN, true);
    expect(out).toContain('<question>\nTell me about yourself.\n</question>');
    expect(out).toContain('<language>en</language>');
  });

  it('omits resume + JD when includeStaticBlocks is false', () => {
    const out = buildUserMessage({ ...MIN, resume: 'R', jobDescription: 'J' }, false);
    expect(out).not.toMatch(/<resume>/);
    expect(out).not.toMatch(/<job_description>/);
  });

  it('includes resume + JD when includeStaticBlocks is true', () => {
    const out = buildUserMessage({ ...MIN, resume: 'R', jobDescription: 'J' }, true);
    expect(out).toMatch(/<resume>\nR\n<\/resume>/);
    expect(out).toMatch(/<job_description>\nJ\n<\/job_description>/);
  });

  it('threads priorTurn as an anchor for follow-ups', () => {
    const out = buildUserMessage(
      {
        ...MIN,
        question: 'What was the outcome?',
        priorTurn: { question: 'Tell me about a conflict.', answer: 'I disagreed with...' },
      },
      true,
    );
    expect(out).toContain('<prior_turn>');
    expect(out).toContain('Tell me about a conflict.');
    expect(out).toContain('I disagreed with...');
    expect(out).toMatch(/continue the SAME story/i);
  });

  it('omits prior_turn when the context has none', () => {
    expect(buildUserMessage(MIN, true)).not.toContain('<prior_turn>');
  });

  it('emits coding_problem + prior_turn together when both present', () => {
    const out = buildUserMessage(
      {
        ...MIN,
        priorTurn: { question: 'prev Q', answer: 'prev A' },
        codingProblem: {
          site: 'leetcode',
          title: 'Two Sum',
          examples: [],
          constraints: [],
          rawText: '',
        },
      },
      true,
    );
    expect(out).toContain('<prior_turn>');
    expect(out).toContain('<coding_problem>');
    expect(out).toContain('<title>Two Sum</title>');
  });
});
