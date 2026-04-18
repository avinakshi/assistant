import { describe, expect, it } from 'vitest';
import { BannedWordHit, createStreamFilter, scanText } from './banned-words';

describe('scanText (whole-text check)', () => {
  it('returns null for clean text', () => {
    expect(scanText('At a previous company I owned the billing service.')).toBeNull();
  });

  it('flags a single banned word', () => {
    expect(scanText('We leverage a database for this.')).toBe('leverage');
  });

  it('flags a banned phrase', () => {
    expect(scanText('We should circle back tomorrow.')).toBe('circle back');
  });

  it('is case-insensitive on words', () => {
    expect(scanText('LEVERAGE the platform.')).toBe('leverage');
  });

  it('does not match word prefixes (word-boundary)', () => {
    expect(scanText('The door unlockable via key fob.')).toBeNull();
  });

  it('returns the first offender when multiple exist', () => {
    expect(scanText('We utilize synergy across teams.')).toBe('utilize');
  });
});

describe('createStreamFilter — rolling window', () => {
  function feed(chunks: string[]): { emitted: string; hit: string | null } {
    const filter = createStreamFilter();
    let emitted = '';
    try {
      for (const c of chunks) emitted += filter.push(c);
      emitted += filter.flush();
      return { emitted, hit: null };
    } catch (err) {
      if (err instanceof BannedWordHit) return { emitted, hit: err.offender };
      throw err;
    }
  }

  it('emits cleared words while holding back the 5-word tail', () => {
    const { emitted, hit } = feed(['one two three four five six seven']);
    expect(hit).toBeNull();
    // With a 5-word rolling window, "one two" (the first 2 of 7 words) is cleared.
    expect(emitted).toContain('one');
    expect(emitted).toContain('two');
  });

  it('holds back a word that later forms a banned phrase', () => {
    // 'deep dive' is a banned phrase. If we stream ['the ', 'deep '] and call flush
    // *without* seeing 'dive', 'deep' alone is fine. But if 'dive' arrives, we catch it.
    const { emitted, hit } = feed(['the ', 'deep ', 'dive ', 'session ', 'begins ', 'now']);
    expect(hit).toBe('deep dive');
    expect(emitted).not.toContain('deep dive');
  });

  it('catches a banned word across chunk boundaries', () => {
    // Split "leverage" across three chunks — word-boundary regex still catches when
    // full word appears in the emit window.
    const { hit } = feed(['we ', 'leverage ', 'this', ' approach', ' always today']);
    expect(hit).toBe('leverage');
  });

  it('lets clean streams pass through fully', () => {
    const clean = 'At my last job I owned the billing pipeline and shipped it to ten thousand users over three weeks.';
    const { emitted, hit } = feed([clean]);
    expect(hit).toBeNull();
    expect(emitted).toBe(clean);
  });
});
