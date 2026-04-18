/**
 * Streaming banned-word detector.
 *
 * Runs on delta text as it arrives from the LLM. Emits the chunks it has cleared (i.e. the
 * parts we are sure contain no banned words) and, if it spots one, throws `BannedWordHit`
 * with the offending word — the caller aborts the stream and retries the prompt.
 *
 * Rolling 5-word window: we can't emit a chunk the moment we receive it, because the final
 * word might be the start of a phrase ("moving forward"). We hold back enough tail to cover
 * the longest banned phrase (in words), currently 4 ("at the end of the day" has 5 but the
 * spec calls for a 5-word rolling window).
 *
 * Matching:
 *   - Case-insensitive.
 *   - Word-boundary for single words (so "unlockable" doesn't trigger "unlock").
 *   - Phrase match as contiguous words.
 */
import { BANNED_WORDS } from '@repo/prompts';

export class BannedWordHit extends Error {
  constructor(readonly offender: string) {
    super(`banned word/phrase detected: '${offender}'`);
    this.name = 'BannedWordHit';
  }
}

const ROLLING_WINDOW_WORDS = 5;

interface Compiled {
  /** Case-insensitive regex that matches any single banned word at word boundaries. */
  readonly wordRe: RegExp;
  /** Lower-cased tokenized banned phrases. */
  readonly phrases: readonly string[][];
}

function compile(words: readonly string[], phrases: readonly string[]): Compiled {
  // Escape regex metacharacters (hyphens, etc.). Word boundary on both sides.
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'));
  const wordRe = new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
  const tokenizedPhrases = phrases.map((p) => p.toLowerCase().split(/\s+/));
  return { wordRe, phrases: tokenizedPhrases };
}

export interface StreamFilter {
  /** Feed a delta. Returns the portion safe to emit downstream. May throw BannedWordHit. */
  push(delta: string): string;
  /** Called when the source stream ends. Returns the remaining held tail. Throws if any banned token was in the tail. */
  flush(): string;
}

export function createStreamFilter(
  words: readonly string[] = BANNED_WORDS.words,
  phrases: readonly string[] = BANNED_WORDS.phrases,
): StreamFilter {
  const compiled = compile(words, phrases);
  let buffer = '';

  const scan = (text: string): void => {
    const m = compiled.wordRe.exec(text);
    if (m) throw new BannedWordHit(m[0].toLowerCase());
    const lowered = text.toLowerCase();
    const tokens = lowered.split(/\s+/).filter(Boolean);
    for (const phraseTokens of compiled.phrases) {
      for (let i = 0; i + phraseTokens.length <= tokens.length; i++) {
        let match = true;
        for (let j = 0; j < phraseTokens.length; j++) {
          const tok = (tokens[i + j] ?? '').replace(/[.,!?;:]+$/g, '');
          if (tok !== phraseTokens[j]) {
            match = false;
            break;
          }
        }
        if (match) throw new BannedWordHit(phraseTokens.join(' '));
      }
    }
  };

  return {
    push(delta) {
      buffer += delta;
      // Split into words; emit everything up to the last ROLLING_WINDOW_WORDS tokens.
      const words = buffer.split(/(\s+)/); // keep whitespace between tokens
      // We want to hold back the tail equivalent to ROLLING_WINDOW_WORDS actual words.
      // Counting *words* from the end, ignoring pure-whitespace items.
      let wordsFromEnd = 0;
      let splitIdx = words.length;
      for (let i = words.length - 1; i >= 0 && wordsFromEnd < ROLLING_WINDOW_WORDS; i--) {
        if (/\S/.test(words[i] ?? '')) {
          wordsFromEnd += 1;
          splitIdx = i;
        }
      }
      const emit = words.slice(0, splitIdx).join('');
      const keep = words.slice(splitIdx).join('');
      if (emit.length > 0) scan(emit);
      buffer = keep;
      return emit;
    },
    flush() {
      if (buffer.length > 0) scan(buffer);
      const tail = buffer;
      buffer = '';
      return tail;
    },
  };
}

/** Convenience: synchronous whole-text check. Used by tests + the final acceptance guard. */
export function scanText(
  text: string,
  words: readonly string[] = BANNED_WORDS.words,
  phrases: readonly string[] = BANNED_WORDS.phrases,
): string | null {
  const filter = createStreamFilter(words, phrases);
  try {
    filter.push(text);
    filter.flush();
    return null;
  } catch (err) {
    if (err instanceof BannedWordHit) return err.offender;
    throw err;
  }
}
