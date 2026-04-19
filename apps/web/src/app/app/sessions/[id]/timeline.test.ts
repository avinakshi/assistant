import { describe, it, expect } from 'vitest';
import { groupEvents, type TimelineEvent } from './timeline';

const ev = (over: Partial<TimelineEvent>): TimelineEvent => ({
  kind: 'transcript',
  payload: {},
  ts: '2026-04-18T12:00:00Z',
  ...over,
});

describe('groupEvents', () => {
  it('returns empty for empty input', () => {
    expect(groupEvents([])).toEqual([]);
  });

  it('pairs a question transcript with the next answer', () => {
    const events = [
      ev({ kind: 'transcript', payload: { text: 'Tell me about yourself.', isQuestion: true } }),
      ev({ kind: 'answer', payload: { answer: 'Sure, I have 5 years...' } }),
    ];
    const grouped = groupEvents(events);
    expect(grouped.length).toBe(1);
    expect(grouped[0]!.ev.kind).toBe('transcript');
    expect(grouped[0]!.pairedAnswer?.kind).toBe('answer');
  });

  it('leaves non-question transcripts unpaired', () => {
    const events = [
      ev({ kind: 'transcript', payload: { text: 'some chatter', isQuestion: false } }),
      ev({ kind: 'answer', payload: { answer: 'irrelevant' } }),
    ];
    const grouped = groupEvents(events);
    // transcript stays solo; answer appears as its own item.
    expect(grouped.length).toBe(2);
    expect(grouped[0]!.pairedAnswer).toBeUndefined();
    expect(grouped[1]!.ev.kind).toBe('answer');
  });

  it('does not steal an answer across a following question', () => {
    const events = [
      ev({ kind: 'transcript', payload: { text: 'Q1?', isQuestion: true } }),
      ev({ kind: 'transcript', payload: { text: 'Q2?', isQuestion: true } }),
      ev({ kind: 'answer', payload: { answer: 'only matches Q2' } }),
    ];
    const grouped = groupEvents(events);
    // Q1 unpaired (search hit Q2 and bailed) + Q2 paired with the answer.
    // The paired answer is consumed so it doesn't render a third time as its own row.
    expect(grouped.length).toBe(2);
    expect(grouped[0]!.pairedAnswer).toBeUndefined();
    expect(grouped[1]!.pairedAnswer?.kind).toBe('answer');
  });

  it('passes ocr events through unchanged', () => {
    const events = [
      ev({ kind: 'ocr', payload: { title: 'Two Sum', site: 'leetcode' } }),
    ];
    const grouped = groupEvents(events);
    expect(grouped).toEqual([{ ev: events[0] }]);
  });

  it('handles multiple Q/A pairs in sequence', () => {
    const events = [
      ev({ kind: 'transcript', payload: { text: 'Q1', isQuestion: true } }),
      ev({ kind: 'answer', payload: { answer: 'A1' } }),
      ev({ kind: 'transcript', payload: { text: 'chatter', isQuestion: false } }),
      ev({ kind: 'transcript', payload: { text: 'Q2', isQuestion: true } }),
      ev({ kind: 'answer', payload: { answer: 'A2' } }),
    ];
    const grouped = groupEvents(events);
    expect(grouped.length).toBe(3);
    expect(grouped[0]!.pairedAnswer?.payload['answer']).toBe('A1');
    expect(grouped[1]!.ev.payload['text']).toBe('chatter');
    expect(grouped[2]!.pairedAnswer?.payload['answer']).toBe('A2');
  });
});
