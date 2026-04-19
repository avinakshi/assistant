import { describe, expect, it } from 'vitest';
import { BANNED_WORDS, BEHAVIORAL_PROMPT, CODING_PROMPT, SYSTEM_DESIGN_PROMPT, promptFor } from './index';

describe('prompt packs', () => {
  it('behavioral pack exists and forbids key banned words in its own instructions', () => {
    expect(BEHAVIORAL_PROMPT.length).toBeGreaterThan(500);
    expect(BEHAVIORAL_PROMPT).toMatch(/banned phrases/i);
  });

  it('coding pack enforces scannable structure (bold headline + code + complexity)', () => {
    expect(CODING_PROMPT).toMatch(/bold.*headline|bold one-line approach/i);
    expect(CODING_PROMPT).toMatch(/complexity/i);
    // Explicitly forbids main() + test-harness boilerplate so answers stay tight.
    expect(CODING_PROMPT).toMatch(/no\s+main|no test cases|no boilerplate/i);
  });

  it('system-design pack prescribes clarifying questions + sizing + deep dives', () => {
    expect(SYSTEM_DESIGN_PROMPT).toMatch(/clarifying questions/i);
    expect(SYSTEM_DESIGN_PROMPT).toMatch(/sizing/i);
    expect(SYSTEM_DESIGN_PROMPT).toMatch(/deep dives/i);
  });

  it('promptFor routes by hint', () => {
    expect(promptFor('behavioral')).toBe(BEHAVIORAL_PROMPT);
    expect(promptFor('coding')).toBe(CODING_PROMPT);
    expect(promptFor('system-design')).toBe(SYSTEM_DESIGN_PROMPT);
  });
});

describe('banned-words config', () => {
  it('has a non-empty words + phrases list', () => {
    expect(BANNED_WORDS.words.length).toBeGreaterThan(10);
    expect(BANNED_WORDS.phrases.length).toBeGreaterThan(3);
  });

  it('includes the canonical corporate-speak offenders', () => {
    expect(BANNED_WORDS.words).toContain('leverage');
    expect(BANNED_WORDS.words).toContain('synergy');
    expect(BANNED_WORDS.phrases).toContain('circle back');
    expect(BANNED_WORDS.phrases).toContain('deep dive');
  });
});
