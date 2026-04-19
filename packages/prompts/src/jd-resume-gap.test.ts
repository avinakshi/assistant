import { describe, it, expect } from 'vitest';
import {
  buildJdResumeGapPrompt,
  parseJdResumeGapResponse,
  renderJdResumeGapForContext,
} from './index';

describe('buildJdResumeGapPrompt', () => {
  it('includes both the resume and JD text', () => {
    const p = buildJdResumeGapPrompt({
      resumeText: 'Name: Jane Doe\nSkills: Go, Rust',
      jdText: 'Looking for a senior Rust engineer with 5+ years',
      role: 'Senior Rust Engineer',
      company: 'Acme',
    });
    expect(p).toContain('Jane Doe');
    expect(p).toContain('senior Rust engineer');
    expect(p).toContain('Senior Rust Engineer at Acme');
    expect(p).toContain('"matches"');
    expect(p).toContain('"likelyQuestions"');
  });

  it('handles empty inputs gracefully', () => {
    const p = buildJdResumeGapPrompt({ resumeText: '', jdText: '' });
    expect(p).toContain('(empty)');
  });
});

describe('parseJdResumeGapResponse', () => {
  it('parses a happy-path JSON response and caps per-section counts', () => {
    const raw = JSON.stringify({
      matches: Array.from({ length: 10 }, (_, i) => `match ${i}`),
      gaps: ['missing Kubernetes', 'no payments experience'],
      likelyQuestions: ['why only 3 yrs?'],
      talkingPoints: ['frame devops as platform work'],
    });
    const out = parseJdResumeGapResponse(raw);
    expect(out).not.toBeNull();
    expect(out!.matches).toHaveLength(6);
    expect(out!.gaps).toEqual(['missing Kubernetes', 'no payments experience']);
    expect(out!.likelyQuestions).toEqual(['why only 3 yrs?']);
    expect(out!.talkingPoints).toEqual(['frame devops as platform work']);
  });

  it('returns null on invalid JSON', () => {
    expect(parseJdResumeGapResponse('not json')).toBeNull();
    expect(parseJdResumeGapResponse('{"matches": "not an array"}')).toBeNull();
  });

  it('drops non-string entries + empty strings', () => {
    const raw = JSON.stringify({
      matches: ['real match', '', 42, null, 'another'],
      gaps: [],
      likelyQuestions: [],
      talkingPoints: [],
    });
    const out = parseJdResumeGapResponse(raw);
    expect(out!.matches).toEqual(['real match', 'another']);
  });

  it('returns null when every section is empty — treat as garbage', () => {
    const raw = JSON.stringify({
      matches: [],
      gaps: [],
      likelyQuestions: [],
      talkingPoints: [],
    });
    expect(parseJdResumeGapResponse(raw)).toBeNull();
  });
});

describe('renderJdResumeGapForContext', () => {
  it('renders a compact directive with the top-3 per section', () => {
    const out = renderJdResumeGapForContext({
      matches: ['a', 'b', 'c', 'd'],
      gaps: ['g1', 'g2', 'g3', 'g4'],
      likelyQuestions: [],
      talkingPoints: ['tp1', 'tp2'],
    });
    expect(out).toContain('Strong matches:');
    expect(out).toContain('- a');
    expect(out).toContain('- c');
    expect(out).not.toContain('- d');
    expect(out).toContain('Gaps to defend:');
    expect(out).toContain('Bridging framings:');
    expect(out).toContain('- tp1');
    expect(out).toContain('- tp2');
  });

  it('skips empty sections', () => {
    const out = renderJdResumeGapForContext({
      matches: ['only match'],
      gaps: [],
      likelyQuestions: [],
      talkingPoints: [],
    });
    expect(out).toContain('Strong matches:');
    expect(out).not.toContain('Gaps to defend:');
    expect(out).not.toContain('Bridging framings:');
  });
});
