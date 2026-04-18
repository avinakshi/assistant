import bannedWords from './banned-words.json';
import { BEHAVIORAL_PROMPT, CODING_PROMPT, SYSTEM_DESIGN_PROMPT } from './packs';

export { BEHAVIORAL_PROMPT, CODING_PROMPT, SYSTEM_DESIGN_PROMPT };

export type PromptPackName = 'behavioral' | 'coding' | 'system-design';

export function promptFor(name: PromptPackName): string {
  switch (name) {
    case 'behavioral':
      return BEHAVIORAL_PROMPT;
    case 'coding':
      return CODING_PROMPT;
    case 'system-design':
      return SYSTEM_DESIGN_PROMPT;
  }
}

export interface BannedWordsConfig {
  readonly version: number;
  readonly words: readonly string[];
  readonly phrases: readonly string[];
}

export const BANNED_WORDS: BannedWordsConfig = {
  version: bannedWords.version,
  words: bannedWords.words,
  phrases: bannedWords.phrases,
};
