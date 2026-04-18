/**
 * Heuristic question detector — decides whether a finalized transcript warrants firing the LLM.
 *
 * v1: pure rules. v2 (post-launch) will layer a fine-tuned DistilBERT classifier on top.
 *
 * Reference: docs/INTERVIEW-COPILOT-COMPLETE.txt §02 SPEC.md 5.4.
 *
 * False positives are worse than false negatives here — spurious LLM fires burn user's LLM
 * quota AND land answers the candidate doesn't need. So the rules err toward silence when
 * the speaker is clearly still mid-thought, an acknowledgment, or the candidate's own voice.
 */

export type QuestionHint = 'behavioral' | 'coding' | 'system_design' | null;

export interface DetectInput {
  text: string;
  prevAnswerEndedAt?: number | null;
  userSpokeRecently?: boolean;
  nowMs?: number;
}

export interface DetectResult {
  isQuestion: boolean;
  confidence: number;
  hint: QuestionHint;
  reason: string;
}

const BEHAVIORAL_PREFIXES = [
  'tell me',
  'describe',
  'walk me through',
  'how would you',
  'how do you',
  'what would you',
  'why did you',
  'explain',
  'can you',
  'have you ever',
  'give me an example',
  "what's your",
  'talk about',
  'imagine',
  'share a time',
  'share an instance',
];

const CODING_TRIGGERS = [
  'implement',
  'write a function',
  'write code',
  'given an array',
  'given a string',
  'given a tree',
  'complexity',
  'big o',
];

const SYSTEM_DESIGN_TRIGGERS = [
  'design a system',
  'design twitter',
  'design uber',
  'design youtube',
  'how would you design',
  'architect a',
  'scale to',
];

const ACKNOWLEDGMENTS = new Set([
  'ok',
  'okay',
  'got it',
  'makes sense',
  'thanks',
  'sure',
  'right',
  'mm hmm',
  'mhm',
  'mm',
  'yeah',
  'yes',
  'no',
  'uh huh',
]);

const FIRST_PERSON_PRONOUNS = /\b(i|my|me|i'm|i've|i'd|i'll|myself)\b/i;
/** If our last answer finished less than this ago, we treat the candidate's voice as likely. */
const CANDIDATE_ECHO_WINDOW_MS = 15_000;

export function classify(input: DetectInput): DetectResult {
  const raw = input.text.trim();
  const lower = raw.toLowerCase();
  const wordCount = raw.split(/\s+/).filter(Boolean).length;

  // Check acknowledgments first — most of them are ≤ 3 words, so checking after the
  // length gate would tag them as 'too-short' and hide the more specific reason.
  const normalizedAck = lower.replace(/[.,!?]+$/g, '');
  if (ACKNOWLEDGMENTS.has(normalizedAck)) {
    return { isQuestion: false, confidence: 0.95, hint: null, reason: 'acknowledgment' };
  }

  if (wordCount < 4) {
    return { isQuestion: false, confidence: 0.9, hint: null, reason: 'too-short' };
  }

  // Candidate-still-speaking heuristic — we just finished an answer and the transcript is
  // in first person. Likely the candidate's own voice (or an echo of it).
  const now = input.nowMs ?? Date.now();
  const sinceLastAnswer = input.prevAnswerEndedAt ? now - input.prevAnswerEndedAt : Infinity;
  if (sinceLastAnswer < CANDIDATE_ECHO_WINDOW_MS && FIRST_PERSON_PRONOUNS.test(raw)) {
    return {
      isQuestion: false,
      confidence: 0.7,
      hint: null,
      reason: 'candidate-echo-window',
    };
  }

  const hint = classifyHint(lower);

  if (raw.endsWith('?')) {
    return {
      isQuestion: true,
      confidence: 0.95,
      hint,
      reason: 'trailing-question-mark',
    };
  }

  if (matchesAny(lower, BEHAVIORAL_PREFIXES)) {
    return {
      isQuestion: true,
      confidence: 0.85,
      hint: hint ?? 'behavioral',
      reason: 'behavioral-prefix',
    };
  }

  if (matchesAny(lower, CODING_TRIGGERS)) {
    return { isQuestion: true, confidence: 0.85, hint: 'coding', reason: 'coding-trigger' };
  }

  if (matchesAny(lower, SYSTEM_DESIGN_TRIGGERS)) {
    return {
      isQuestion: true,
      confidence: 0.85,
      hint: 'system_design',
      reason: 'system-design-trigger',
    };
  }

  return { isQuestion: false, confidence: 0.6, hint: null, reason: 'no-trigger' };
}

function matchesAny(lower: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (lower.startsWith(n) || lower.includes(` ${n}`)) return true;
  }
  return false;
}

function classifyHint(lower: string): QuestionHint {
  if (matchesAny(lower, CODING_TRIGGERS)) return 'coding';
  if (matchesAny(lower, SYSTEM_DESIGN_TRIGGERS)) return 'system_design';
  if (matchesAny(lower, BEHAVIORAL_PREFIXES)) return 'behavioral';
  return null;
}
