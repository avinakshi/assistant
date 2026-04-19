import { describe, it, expect } from 'vitest';
import {
  buildSessionChatPrompt,
  renderSessionChatTranscript,
  type SessionChatEvent,
} from './index';

const transcriptEvent = (text: string, isQuestion: boolean, source?: 'interviewer' | 'candidate') => ({
  kind: 'transcript',
  payload: {
    text,
    isQuestion,
    ...(source ? { source } : {}),
  },
}) satisfies SessionChatEvent;

const answerEvent = (answer: string) => ({
  kind: 'answer',
  payload: { answer, question: 'q', provider: 'gemini', mode: 'behavioral' },
}) satisfies SessionChatEvent;

describe('renderSessionChatTranscript', () => {
  it('numbers questions sequentially and labels the source', () => {
    const out = renderSessionChatTranscript([
      transcriptEvent('Tell me about yourself.', true, 'interviewer'),
      transcriptEvent('I\u2019m a senior engineer.', false, 'candidate'),
      transcriptEvent('What\u2019s your greatest weakness?', true, 'interviewer'),
    ]);
    expect(out).toContain('Q1 (interviewer): Tell me about yourself.');
    expect(out).toContain('[candidate] I\u2019m a senior engineer.');
    expect(out).toContain('Q2 (interviewer): What\u2019s your greatest weakness?');
  });

  it('inlines AI-suggested answers under their question', () => {
    const out = renderSessionChatTranscript([
      transcriptEvent('Tell me about a conflict.', true),
      answerEvent('I use STAR: Situation, Task, Action, Result...'),
    ]);
    expect(out).toContain('Q1');
    expect(out).toContain('A1 (AI suggestion to candidate): I use STAR');
  });

  it('defaults source to interviewer when the tag is missing (pre-diarize rows)', () => {
    const out = renderSessionChatTranscript([transcriptEvent('Q without source', true)]);
    expect(out).toContain('(interviewer)');
  });

  it('skips empty text and unknown event kinds', () => {
    const out = renderSessionChatTranscript([
      transcriptEvent('', true),
      { kind: 'heartbeat', payload: { beat: 1 } },
      transcriptEvent('Real question.', true),
    ]);
    expect(out).not.toContain('heartbeat');
    expect(out.match(/Q\d+/g)?.length).toBe(1);
  });

  it('renders ocr rows as screenshot markers', () => {
    const out = renderSessionChatTranscript([
      { kind: 'ocr', payload: { title: 'Two Sum', site: 'leetcode' } },
    ]);
    expect(out).toContain('[screenshot] Two Sum (leetcode)');
  });

  it('truncates oversized transcripts from the front, preserving the tail', () => {
    const long = 'x'.repeat(20_000);
    const out = renderSessionChatTranscript([
      transcriptEvent(long, true),
      transcriptEvent('THIS SHOULD BE IN THE OUTPUT.', true),
    ]);
    // Tail preserved.
    expect(out).toContain('THIS SHOULD BE IN THE OUTPUT.');
    // Truncation marker present.
    expect(out).toContain('earlier turns truncated');
    // Length capped (approximately).
    expect(out.length).toBeLessThan(15_000);
  });
});

describe('buildSessionChatPrompt', () => {
  it('bakes transcript + user question into a single first message when history is empty', () => {
    const { systemPrompt, messages } = buildSessionChatPrompt({
      events: [transcriptEvent('How do you handle conflict?', true)],
      history: [],
      userMessage: 'Rewrite my answer to be tighter.',
    });
    expect(systemPrompt).toContain('interview coach');
    expect(messages.length).toBe(1);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toContain('How do you handle conflict');
    expect(messages[0]!.content).toContain('Rewrite my answer to be tighter.');
  });

  it('on subsequent turns, skips the transcript block (it was sent in turn 1)', () => {
    const { messages } = buildSessionChatPrompt({
      events: [transcriptEvent('Q', true)],
      history: [
        { role: 'user', content: 'First user message with transcript' },
        { role: 'assistant', content: 'First reply' },
      ],
      userMessage: 'Follow-up question',
    });
    expect(messages.length).toBe(3);
    expect(messages[2]!.role).toBe('user');
    expect(messages[2]!.content).toBe('Follow-up question');
    // Transcript block should not be duplicated in the new message.
    expect(messages[2]!.content).not.toContain('Transcript:');
  });

  it('includes role + company + recap in the context header when provided', () => {
    const { messages } = buildSessionChatPrompt({
      events: [transcriptEvent('Q', true)],
      history: [],
      userMessage: 'hi',
      role: 'Senior Engineer',
      company: 'Acme',
      recap: {
        topics: ['system design'],
        highlights: ['Good structure'],
        improvements: ['Add quantified impact'],
      },
    });
    const first = messages[0]!.content;
    expect(first).toContain('Senior Engineer at Acme');
    expect(first).toContain('system design');
    expect(first).toContain('Add quantified impact');
  });

  it('shows a placeholder when there are no events', () => {
    const { messages } = buildSessionChatPrompt({
      events: [],
      history: [],
      userMessage: 'hi',
    });
    expect(messages[0]!.content).toContain('(no transcript events captured)');
  });
});
