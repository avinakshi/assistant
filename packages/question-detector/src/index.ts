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

export type QuestionHint = 'behavioral' | 'coding' | 'system_design' | 'technical' | null;

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
  'tell me about',
  'walk me through',
  'describe',
  'how would you',
  'how do you handle',
  'how do you approach',
  'what would you do',
  'why did you',
  'have you ever',
  'give me an example',
  "what's your greatest",
  "what's your biggest",
  'talk about',
  'share a time',
  'share an instance',
  'can you give an example',
  // NOTE: "explain" used to live here but is now a TECHNICAL trigger — "explain X"
  // almost always means "explain a concept", not "tell a story". See Phase-13 fix.
];

/**
 * Phase-13 fix. Triggers that usually mean "explain this concept" rather than "tell me
 * a story about yourself". Classifying these as technical drops the STAR framing and
 * gives direct prose instead — much better answer quality for the common case of
 * "What is X?", "Difference between Y and Z?", "How does W work?".
 *
 * Uses a loose match: the trigger must appear in the text AND the text must not
 * otherwise look behavioral. The behavioral-prefix checks above have already run; if
 * the question matched those more specific stems, we won't reach here.
 */
const TECHNICAL_TRIGGERS = [
  'what is',
  'what are',
  'what does',
  'what do you mean by',
  'what is meant by',
  'what\u2019s the difference',
  "what's the difference",
  'difference between',
  'how does',
  'how do',
  'explain',
  'why is',
  'why does',
  'why do',
  'when should',
  'when do you use',
  'pros and cons',
  'trade-offs',
  'tradeoffs',
];

/**
 * Regex patterns that detect coding-problem stems even when the interviewer drops in
 * a language modifier ("Write a **JavaScript** function to…", "Create an **efficient**
 * algorithm…"). String-prefix matching was too rigid — it required exactly "write a
 * function" with nothing in between. Each pattern is anchored loosely: the stem must
 * appear as a run of words somewhere in the sentence.
 */
const CODING_PATTERNS: readonly RegExp[] = [
  // "write/create/build/code/design a [JavaScript|efficient|recursive|…] function/program/method/algorithm"
  /\b(?:write|create|build|code|design|develop)\s+(?:a|an|the)\s+(?:\w+\s+){0,3}(?:function|program|method|algorithm|class|routine|solution)\b/i,
  /\bimplement\b/i,
  // "given a/an [sorted|…] array/string/list/tree/graph/matrix/linked list"
  /\bgiven\s+(?:a|an|the)?\s*(?:\w+\s+){0,2}(?:array|string|list|tree|graph|matrix|linked\s*list|queue|stack|heap|interval)\b/i,
  // Complexity talk.
  /\b(?:time|space)\s+complexity\b/i,
  /\bbig\s*o\b/i,
  /\bin\s+o\s*\(/i,
  // "find the largest/smallest/maximum/minimum/kth/first/last <noun>"
  /\bfind\s+(?:the|a|an|all)\s+(?:\w+\s+){0,3}(?:largest|smallest|maximum|minimum|longest|shortest|kth|k-?th|first|last|nth|missing|duplicate|number|element|pair|subarray|substring|sequence|path|palindrome)\b/i,
  // "return the <noun>" in an imperative sense
  /\breturn\s+(?:the|a|an)\s+(?:\w+\s+){0,3}(?:result|answer|value|array|string|number|index|count|list|sum|product|length|subsequence|substring|pair|path|indices|combination)\b/i,
  // "check if X is Y" / "check whether"
  /\bcheck\s+(?:if|whether)\b/i,
  // "count the number of X"
  /\bcount\s+(?:the\s+)?(?:number\s+of|occurrences|instances)\b/i,
  // Reverse/sort/rotate/permute/traverse
  /\b(?:reverse|sort|rotate|permute|traverse|swap|merge|partition)\s+(?:a|an|the)\b/i,
];

/**
 * Back-compat string stems, matched only as a fallback when no regex pattern hits.
 * Kept minimal so the regex patterns above remain the primary path.
 */
const CODING_TRIGGERS = [
  'implement',
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

  if (matchesAnyPattern(lower, CODING_PATTERNS) || matchesAny(lower, CODING_TRIGGERS)) {
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

  // Phase-13 fix: technical-concept stems ("what is X", "how does Y", "difference
  // between A and B"). These used to either miss the gate entirely or fall through to
  // behavioral — both wrong. We now fire the LLM with hint=technical.
  if (matchesAny(lower, TECHNICAL_TRIGGERS)) {
    return { isQuestion: true, confidence: 0.8, hint: 'technical', reason: 'technical-trigger' };
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
  if (matchesAnyPattern(lower, CODING_PATTERNS) || matchesAny(lower, CODING_TRIGGERS)) return 'coding';
  if (matchesAny(lower, SYSTEM_DESIGN_TRIGGERS)) return 'system_design';
  if (matchesAny(lower, BEHAVIORAL_PREFIXES)) return 'behavioral';
  if (matchesAny(lower, TECHNICAL_TRIGGERS)) return 'technical';
  return null;
}

function matchesAnyPattern(lower: string, patterns: readonly RegExp[]): boolean {
  for (const p of patterns) {
    if (p.test(lower)) return true;
  }
  return false;
}
