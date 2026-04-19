import bannedWords from './banned-words.json';
import {
  BEHAVIORAL_PROMPT,
  CODING_PROMPT,
  SYSTEM_DESIGN_PROMPT,
  TECHNICAL_PROMPT,
} from './packs';

export { BEHAVIORAL_PROMPT, CODING_PROMPT, SYSTEM_DESIGN_PROMPT, TECHNICAL_PROMPT };
export {
  buildOpeningPrompt,
  buildTurnPrompt,
  buildFinalizePrompt,
  type PracticeMode,
  type InterviewContext,
  type TurnHistoryEntry,
  type BuildTurnPromptInput,
  type BuildFinalizePromptInput,
} from './interviewer';
export {
  buildLiveRecapPrompt,
  parseLiveRecapResponse,
  type LiveRecap,
  type LiveRecapEvent,
  type BuildLiveRecapInput,
} from './live-recap';
export {
  buildSessionChatPrompt,
  renderTranscript as renderSessionChatTranscript,
  type SessionChatEvent,
  type SessionChatMessage,
  type SessionChatRole,
  type BuildSessionChatInput,
  type BuildSessionChatOutput,
} from './session-chat';
export {
  buildJdResumeGapPrompt,
  parseJdResumeGapResponse,
  renderJdResumeGapForContext,
  type BuildJdResumeGapInput,
  type JdResumeGap,
} from './jd-resume-gap';

export type PromptPackName = 'behavioral' | 'coding' | 'system-design' | 'technical';

export function promptFor(name: PromptPackName): string {
  switch (name) {
    case 'behavioral':
      return BEHAVIORAL_PROMPT;
    case 'coding':
      return CODING_PROMPT;
    case 'system-design':
      return SYSTEM_DESIGN_PROMPT;
    case 'technical':
      return TECHNICAL_PROMPT;
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
