import { describe, expect, it } from 'vitest';
import { classify } from './index';

describe('question detector — positive cases', () => {
  const NOW = 1_700_000_000_000;

  it.each([
    ['Tell me about yourself.', 'behavioral'],
    ['Walk me through a time you handled a conflict', 'behavioral'],
    ['Describe your most challenging project', 'behavioral'],
    ['How would you approach this problem?', 'behavioral'],
    ['Why did you leave your last role?', 'behavioral'],
    ['Give me an example of leadership', 'behavioral'],
    ['Implement a function that reverses a linked list', 'coding'],
    ['Given an array of integers, find the duplicates', 'coding'],
    ['Write a function to check for palindromes', 'coding'],
    ["What's the time complexity of your approach?", 'coding'],
    ['Design a system like Twitter', 'system_design'],
    ['How would you design a URL shortener?', 'system_design'],
    ['Architect a scalable chat service', 'system_design'],
  ])('flags as question: "%s" → hint=%s', (text, expectedHint) => {
    const r = classify({ text, nowMs: NOW });
    expect(r.isQuestion).toBe(true);
    expect(r.hint).toBe(expectedHint);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('flags anything ending in ? as question with high confidence', () => {
    const r = classify({ text: 'so uh could you maybe explain that?', nowMs: NOW });
    expect(r.isQuestion).toBe(true);
    expect(r.reason).toBe('trailing-question-mark');
  });
});

describe('question detector — negative cases', () => {
  const NOW = 1_700_000_000_000;

  it.each([
    ['ok', 'acknowledgment'],
    ['yeah', 'acknowledgment'],
    ['Got it.', 'acknowledgment'],
    ['makes sense', 'acknowledgment'],
    ['mhm', 'acknowledgment'],
  ])('rejects acknowledgment "%s"', (text, expectedReason) => {
    const r = classify({ text, nowMs: NOW });
    expect(r.isQuestion).toBe(false);
    expect(r.reason).toBe(expectedReason);
  });

  it('rejects under-4-word utterances', () => {
    const r = classify({ text: 'right so next', nowMs: NOW });
    expect(r.isQuestion).toBe(false);
    expect(r.reason).toBe('too-short');
  });

  it('rejects first-person speech inside the candidate echo window', () => {
    const r = classify({
      text: "I think I would approach it by breaking down the sub-problems",
      prevAnswerEndedAt: NOW - 5_000, // 5 s ago — inside 15 s window
      nowMs: NOW,
    });
    expect(r.isQuestion).toBe(false);
    expect(r.reason).toBe('candidate-echo-window');
  });

  it('accepts first-person speech OUTSIDE the candidate echo window', () => {
    // Transcript starts with "tell me" — behavioral prefix. First-person words present,
    // but the window has passed, so we trust the prefix.
    const r = classify({
      text: 'Tell me about the most difficult technical trade-off you faced',
      prevAnswerEndedAt: NOW - 60_000, // 60 s ago — outside 15 s window
      nowMs: NOW,
    });
    expect(r.isQuestion).toBe(true);
  });

  it('rejects free-form narrative with no trigger', () => {
    const r = classify({
      text: 'Our team is currently rebuilding the billing platform',
      nowMs: NOW,
    });
    expect(r.isQuestion).toBe(false);
    expect(r.reason).toBe('no-trigger');
  });
});

describe('question detector — hint classification precedence', () => {
  const NOW = 1_700_000_000_000;
  // When both a behavioral prefix AND a coding/system-design trigger match, the more
  // specific hint wins so the prompt pack picks the right template.
  it('coding trigger beats behavioral prefix', () => {
    const r = classify({
      text: 'Can you implement a queue using two stacks?',
      nowMs: NOW,
    });
    expect(r.isQuestion).toBe(true);
    expect(r.hint).toBe('coding');
  });

  it('system-design trigger beats behavioral prefix', () => {
    const r = classify({
      text: 'How would you design a distributed cache?',
      nowMs: NOW,
    });
    expect(r.isQuestion).toBe(true);
    expect(r.hint).toBe('system_design');
  });
});
