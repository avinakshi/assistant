/**
 * Interviewer-side prompts for practice mode. These are the opposite polarity from the
 * candidate-side packs (BEHAVIORAL_PROMPT etc.): here the LLM plays the interviewer —
 * asks concise questions, listens to the candidate, provides feedback, asks follow-ups.
 *
 * Each prompt returns a JSON response so the web app can render structured UI.
 *
 * Three lifecycle moments:
 *   1. `buildOpeningPrompt`  → first question for a fresh session.
 *   2. `buildTurnPrompt`     → after the candidate replies: feedback + next question.
 *   3. `buildFinalizePrompt` → at session end: overall scorecard.
 */

export type PracticeMode = 'behavioral' | 'coding' | 'system_design';

export interface InterviewContext {
  /** Candidate's resume summary text (optional). Shortens LLM ramp-up time. */
  readonly resumeText?: string;
  /** JD body (optional). Lets questions target the role. */
  readonly jdText?: string;
  readonly role?: string;
  readonly company?: string;
  /** Total questions the interviewer should aim for. Default: 6. */
  readonly maxQuestions?: number;
}

const MODE_DIRECTION: Record<PracticeMode, string> = {
  behavioral:
    'Ask behavioral questions probing leadership, collaboration, conflict resolution, ' +
    'ownership, and specific past projects. Always request concrete examples with the ' +
    'STAR pattern (Situation, Task, Action, Result). Push back on vague answers.',
  coding:
    'Ask algorithm or data-structure questions that can be solved verbally — the ' +
    'candidate narrates approach, complexity, edge cases. No IDE. If the candidate ' +
    'skips over complexity, ask them to analyze it.',
  system_design:
    'Ask a system-design question (e.g., design X). Push the candidate to clarify ' +
    'scale assumptions, choose storage, discuss failure modes, and sketch data flow.',
};

const BASE_RULES = [
  'You are a senior interviewer, not an assistant.',
  'Keep every question to ONE SHORT SENTENCE. No preambles like "Great answer, next question…".',
  'Never reveal scores or coach during the session — that comes in the final review.',
  'Vary question types so the candidate doesn\'t see a script.',
  'Do not invent facts about the candidate or the company.',
];

export function buildOpeningPrompt(mode: PracticeMode, ctx: InterviewContext = {}): string {
  const target = [ctx.role, ctx.company ? `at ${ctx.company}` : null].filter(Boolean).join(' ');
  const targetLine = target ? `Role context: ${target}.\n` : '';
  const resumeLine = ctx.resumeText
    ? `Candidate's resume excerpt:\n${ctx.resumeText.slice(0, 2000)}\n`
    : '';
  const jdLine = ctx.jdText ? `JD excerpt:\n${ctx.jdText.slice(0, 2000)}\n` : '';

  return [
    BASE_RULES.join(' '),
    MODE_DIRECTION[mode],
    targetLine,
    resumeLine,
    jdLine,
    'Open with ONE warm but pointed question to kick off. Return JSON:',
    '{ "question": "<the question>" }',
    'Return ONLY the JSON object, no prose before or after.',
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

export interface TurnHistoryEntry {
  readonly question: string;
  readonly answer: string;
}

export interface BuildTurnPromptInput {
  readonly mode: PracticeMode;
  readonly ctx?: InterviewContext;
  readonly history: readonly TurnHistoryEntry[];
  readonly latestAnswer: string;
  /** Total questions asked so far, including the one just answered. */
  readonly questionsAskedSoFar: number;
}

export function buildTurnPrompt(input: BuildTurnPromptInput): string {
  const max = input.ctx?.maxQuestions ?? 6;
  const remaining = Math.max(0, max - input.questionsAskedSoFar);
  const historyLines = input.history
    .map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer}`)
    .join('\n\n');

  const latest = input.history[input.history.length - 1];
  const currentQ = latest?.question ?? '';
  return [
    BASE_RULES.join(' '),
    MODE_DIRECTION[input.mode],
    `Questions remaining after this turn: ${remaining}.`,
    historyLines ? `Transcript so far:\n${historyLines}` : '',
    `The candidate just answered Q${input.questionsAskedSoFar}: "${currentQ}"`,
    `Their answer:\n${input.latestAnswer}`,
    'Evaluate the answer on four axes (0–5 each):',
    '- communication: clarity, conciseness',
    '- specificity: concrete examples, numbers, names',
    '- structure: logical flow (STAR for behavioral, stepwise for coding/design)',
    '- relevance: addressed the question',
    `Then ${remaining > 0 ? 'ask ONE follow-up question OR a new question' : 'return null for nextQuestion (session is ending)'}.`,
    'Return JSON:',
    '{',
    '  "scores": { "communication": n, "specificity": n, "structure": n, "relevance": n },',
    '  "notes": "1-2 sentence rationale",',
    `  "nextQuestion": ${remaining > 0 ? '"<question>"' : 'null'}`,
    '}',
    'Return ONLY the JSON object.',
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

export interface BuildFinalizePromptInput {
  readonly mode: PracticeMode;
  readonly ctx?: InterviewContext;
  readonly history: readonly TurnHistoryEntry[];
  /** Per-turn scores from buildTurnPrompt responses. */
  readonly turnScores: readonly {
    readonly communication: number;
    readonly specificity: number;
    readonly structure: number;
    readonly relevance: number;
  }[];
}

export function buildFinalizePrompt(input: BuildFinalizePromptInput): string {
  const historyLines = input.history
    .map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer}`)
    .join('\n\n');

  return [
    `You are a senior interviewer writing the final review after a ${input.mode} practice session.`,
    historyLines ? `Full transcript:\n${historyLines}` : 'No turns happened — return empty arrays.',
    'Synthesize an honest final review. Be specific, quote moments from the transcript where possible. Avoid corporate-speak.',
    'Return JSON:',
    '{',
    '  "scores": { "communication": n, "specificity": n, "structure": n, "relevance": n },  // overall 0-5',
    '  "highlights": ["one-line moment 1", "one-line moment 2"],',
    '  "improvements": ["actionable nudge 1", "actionable nudge 2"]',
    '}',
    'Keep highlights + improvements to 2-3 items each. Return ONLY the JSON object.',
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}
