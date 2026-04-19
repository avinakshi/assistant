import { describe, it, expect } from 'vitest';
import { exportTranscriptMarkdown, exportLiveTranscriptMarkdown } from './transcript';

describe('exportTranscriptMarkdown', () => {
  const base = {
    mode: 'behavioral',
    startedAt: new Date('2026-04-18T12:00:00Z'),
  };

  it('renders a minimal session with just one Q', () => {
    const md = exportTranscriptMarkdown({
      ...base,
      turns: [{ index: 0, question: 'Tell me about yourself.' }],
    });
    expect(md).toContain('# Practice session — Behavioral');
    expect(md).toContain('## Q1');
    expect(md).toContain('Tell me about yourself.');
  });

  it('includes answer + feedback chips in order', () => {
    const md = exportTranscriptMarkdown({
      ...base,
      turns: [
        {
          index: 0,
          question: 'Describe a failure.',
          answer: 'I shipped a regression.',
          feedback: {
            scores: { communication: 4, specificity: 3, structure: 4, relevance: 5 },
            notes: 'Good concrete example.',
          },
        },
      ],
    });
    expect(md).toMatch(/\*\*Answer\.\*\* I shipped a regression\./);
    expect(md).toMatch(/avg 4\.0\/5/);
    expect(md).toMatch(/communication 4\.0/);
    expect(md).toMatch(/> Good concrete example\./);
  });

  it('renders the final review block when a summary is provided', () => {
    const md = exportTranscriptMarkdown({
      ...base,
      turns: [{ index: 0, question: 'Q', answer: 'A' }],
      summary: {
        scores: { communication: 4, specificity: 4, structure: 4, relevance: 4 },
        highlights: ['Clear STAR flow'],
        improvements: ['Quantify impact'],
      },
    });
    expect(md).toContain('## Final review');
    expect(md).toMatch(/Overall \*\*4\.0\/5\*\*/);
    expect(md).toContain('- Clear STAR flow');
    expect(md).toContain('- Quantify impact');
  });

  it('handles missing axis scores without crashing', () => {
    const md = exportTranscriptMarkdown({
      ...base,
      turns: [
        {
          index: 0,
          question: 'Q',
          answer: 'A',
          feedback: { scores: { communication: 3 } },
        },
      ],
    });
    // Only communication appears in the chip; the others are skipped.
    expect(md).toMatch(/communication 3\.0/);
    expect(md).not.toMatch(/specificity \d/);
  });

  it('translates system_design mode label', () => {
    const md = exportTranscriptMarkdown({
      ...base,
      mode: 'system_design',
      turns: [],
    });
    expect(md).toContain('# Practice session — System design');
  });
});

describe('exportLiveTranscriptMarkdown', () => {
  const liveBase = {
    mode: 'auto',
    startedAt: new Date('2026-04-19T10:00:00Z'),
    events: [],
  };

  it('renders a header with mode + start time', () => {
    const md = exportLiveTranscriptMarkdown(liveBase);
    expect(md).toContain('# Live interview — auto');
    expect(md).toContain('_2026-04-19T10:00:00.000Z_');
  });

  it('pairs a question transcript with the next answer event', () => {
    const md = exportLiveTranscriptMarkdown({
      ...liveBase,
      events: [
        {
          kind: 'transcript',
          payload: { text: 'Tell me about a conflict.', isQuestion: true },
          ts: '2026-04-19T10:00:01Z',
        },
        {
          kind: 'answer',
          payload: { answer: 'I disagreed with my manager...' },
          ts: '2026-04-19T10:00:02Z',
        },
      ],
    });
    expect(md).toMatch(/\*\*Q\.\*\* Tell me about a conflict\./);
    expect(md).toMatch(/\*\*AI suggestion\.\*\* I disagreed with my manager\.\.\./);
  });

  it('renders non-question transcripts as blockquotes', () => {
    const md = exportLiveTranscriptMarkdown({
      ...liveBase,
      events: [
        {
          kind: 'transcript',
          payload: { text: 'Thanks for joining today.', isQuestion: false },
          ts: '2026-04-19T10:00:01Z',
        },
      ],
    });
    expect(md).toContain('> Thanks for joining today.');
  });

  it('emits screenshot markers with title + site', () => {
    const md = exportLiveTranscriptMarkdown({
      ...liveBase,
      events: [
        {
          kind: 'ocr',
          payload: { title: 'Two Sum', site: 'leetcode' },
          ts: '2026-04-19T10:00:01Z',
        },
      ],
    });
    expect(md).toContain('*[screenshot] Two Sum — leetcode*');
  });

  it('emits a topics-covered section when supplied', () => {
    const md = exportLiveTranscriptMarkdown({
      ...liveBase,
      topics: ['leadership', 'system design'],
    });
    expect(md).toContain('## Topics covered');
    expect(md).toContain('- leadership');
    expect(md).toContain('- system design');
  });

  it('does not cross-pair questions — Q1 without A before Q2 stays unpaired', () => {
    const md = exportLiveTranscriptMarkdown({
      ...liveBase,
      events: [
        { kind: 'transcript', payload: { text: 'Q1?', isQuestion: true }, ts: 'a' },
        { kind: 'transcript', payload: { text: 'Q2?', isQuestion: true }, ts: 'b' },
        { kind: 'answer', payload: { answer: 'A for Q2' }, ts: 'c' },
      ],
    });
    // Both questions appear; AI suggestion shows up once (after Q2).
    const aiSuggestionMatches = md.match(/\*\*AI suggestion\.\*\*/g) ?? [];
    expect(aiSuggestionMatches.length).toBe(1);
    expect(md).toContain('Q1?');
    expect(md).toContain('Q2?');
  });
});
