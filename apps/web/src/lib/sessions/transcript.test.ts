import { describe, it, expect } from 'vitest';
import { exportTranscriptMarkdown } from './transcript';

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
