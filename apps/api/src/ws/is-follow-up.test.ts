import { describe, it, expect } from 'vitest';
// Ensure config's required env is loaded before importing session-orchestrator (which
// pulls in config via a transitive import).
process.env.WS_SHARED_SECRET ??= 'test-secret-0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { isFollowUp } = await import('./session-orchestrator');

describe('isFollowUp', () => {
  const followUps = [
    'Why?',
    'How so?',
    'And then?',
    'What was the outcome?',
    'What happened next?',
    'Tell me more.',
    'Can you elaborate?',
    'Could you elaborate on that?',
    'Go on.',
    'Expand on that.',
    'Why do you say that?',
    'And what did the team think?',
    'So what did you learn?',
    'But wasn\'t that risky?',
  ];

  const freshQuestions = [
    'Tell me about a time you shipped a bug to production.',
    'Describe a system you designed that handled more than a million requests per second.',
    'How would you explain eventual consistency to a non-technical stakeholder?',
    'Walk me through how you handle incident response at a previous company.',
    'What frameworks have you used for observability and what do you like about them?',
  ];

  it.each(followUps)('treats %o as a follow-up', (q) => {
    expect(isFollowUp(q)).toBe(true);
  });

  it.each(freshQuestions)('treats %o as a fresh question', (q) => {
    expect(isFollowUp(q)).toBe(false);
  });

  it('handles empty / whitespace-only input gracefully', () => {
    expect(isFollowUp('')).toBe(false);
    expect(isFollowUp('   ')).toBe(false);
  });

  it('strips trailing punctuation before matching', () => {
    expect(isFollowUp('Why?!')).toBe(true);
    expect(isFollowUp('Why.')).toBe(true);
  });
});
