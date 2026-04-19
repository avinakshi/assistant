import { describe, it, expect } from 'vitest';
import { buildLiveRecapPrompt, parseLiveRecapResponse } from './live-recap';

describe('buildLiveRecapPrompt', () => {
  it('renders questions + answers with Q/A indexing', () => {
    const p = buildLiveRecapPrompt({
      events: [
        { kind: 'transcript', payload: { text: 'Tell me about yourself.', isQuestion: true } },
        { kind: 'answer', payload: { answer: 'I am a senior engineer...' } },
        { kind: 'transcript', payload: { text: 'What is your greatest strength?', isQuestion: true } },
        { kind: 'answer', payload: { answer: 'Attention to detail...' } },
      ],
    });
    expect(p).toContain('Q1: Tell me about yourself.');
    expect(p).toContain('A1 (AI suggestion): I am a senior engineer...');
    expect(p).toContain('Q2: What is your greatest strength?');
    expect(p).toContain('A2 (AI suggestion): Attention to detail...');
  });

  it('marks non-question transcripts as [chatter]', () => {
    const p = buildLiveRecapPrompt({
      events: [
        { kind: 'transcript', payload: { text: 'Thanks for joining.', isQuestion: false } },
      ],
    });
    expect(p).toContain('[chatter] Thanks for joining.');
  });

  it('renders OCR events with title + site', () => {
    const p = buildLiveRecapPrompt({
      events: [
        { kind: 'ocr', payload: { title: 'Two Sum', site: 'leetcode' } },
      ],
    });
    expect(p).toContain('[screenshot] Two Sum (leetcode)');
  });

  it('prints (empty) for no events', () => {
    expect(buildLiveRecapPrompt({ events: [] })).toContain('(empty)');
  });

  it('threads role + company into the context line', () => {
    const p = buildLiveRecapPrompt({
      events: [],
      role: 'Senior SRE',
      company: 'Stripe',
    });
    expect(p).toContain('Senior SRE');
    expect(p).toContain('Stripe');
  });

  it('is explicit that A lines are AI suggestions (not candidate speech)', () => {
    const p = buildLiveRecapPrompt({ events: [] });
    expect(p).toMatch(/AI copilot suggested/);
    expect(p).toMatch(/NOT what the candidate actually said/);
  });

  it('asks for a specific JSON shape', () => {
    const p = buildLiveRecapPrompt({ events: [] });
    expect(p).toContain('topicsCovered');
    expect(p).toContain('highlights');
    expect(p).toContain('improvements');
    expect(p).toMatch(/Return ONLY the JSON object/);
  });
});

describe('parseLiveRecapResponse', () => {
  it('parses a well-formed response', () => {
    const raw = JSON.stringify({
      topicsCovered: ['leadership', 'conflict resolution'],
      highlights: ['Candidate cited specific numbers'],
      improvements: ['Use STAR format more consistently'],
    });
    expect(parseLiveRecapResponse(raw)).toEqual({
      topicsCovered: ['leadership', 'conflict resolution'],
      highlights: ['Candidate cited specific numbers'],
      improvements: ['Use STAR format more consistently'],
    });
  });

  it('returns null on invalid JSON', () => {
    expect(parseLiveRecapResponse('not json')).toBeNull();
    expect(parseLiveRecapResponse('null')).toBeNull();
  });

  it('caps each array to its max and trims', () => {
    const many = Array.from({ length: 20 }, (_, i) => `  item ${i}  `);
    const raw = JSON.stringify({ topicsCovered: many, highlights: many, improvements: many });
    const out = parseLiveRecapResponse(raw);
    expect(out?.topicsCovered.length).toBe(8);
    expect(out?.highlights.length).toBe(4);
    expect(out?.improvements.length).toBe(4);
    expect(out?.topicsCovered[0]).toBe('item 0');
  });

  it('drops non-string entries without crashing', () => {
    const raw = JSON.stringify({
      topicsCovered: ['a', 123, null, { x: 1 }, 'b'],
      highlights: [],
      improvements: [],
    });
    expect(parseLiveRecapResponse(raw)?.topicsCovered).toEqual(['a', 'b']);
  });

  it('drops empty / whitespace-only strings', () => {
    const raw = JSON.stringify({
      topicsCovered: ['a', '', '   ', 'b'],
      highlights: [],
      improvements: [],
    });
    expect(parseLiveRecapResponse(raw)?.topicsCovered).toEqual(['a', 'b']);
  });

  it('defaults missing arrays to empty', () => {
    const raw = JSON.stringify({ topicsCovered: ['a'] });
    expect(parseLiveRecapResponse(raw)).toEqual({
      topicsCovered: ['a'],
      highlights: [],
      improvements: [],
    });
  });
});
