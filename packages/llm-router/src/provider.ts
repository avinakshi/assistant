/**
 * LLM provider interface — one face for Claude, GPT, and Gemini.
 *
 * Phase 4 scope: Gemini implementation only. Claude + OpenAI land in Phase 4b with prompt
 * caching. The interface is designed so the switch-over is a router config change, not a
 * caller change.
 *
 * Streaming contract:
 *   - `stream()` returns an async iterable of *text deltas* (not tokens, not whole chunks).
 *     Callers accumulate. If a retry is needed (banned-word filter), the router calls
 *     `stream()` again with amended `retryHint` — the provider is stateless between calls.
 *   - Cancellation via `AbortSignal`. Providers must close upstream connections promptly
 *     on abort; leaked streams cost real money.
 */

export type ProviderName = 'gemini' | 'claude' | 'gpt-5' | 'gpt-4.1';

export type AnswerMode = 'behavioral' | 'coding' | 'system_design' | 'technical' | 'auto';

/**
 * Structural mirror of `@repo/ocr.CodingProblem`. Duplicated here so llm-router doesn't
 * depend on ocr (which would pull HTTP + cache code into every consumer). Shapes must stay
 * in sync with packages/ocr/src/types.ts.
 */
export interface CodingProblemLike {
  readonly site: 'leetcode' | 'hackerrank' | 'unknown';
  readonly title?: string;
  readonly description?: string;
  readonly examples: readonly {
    readonly input?: string;
    readonly output?: string;
    readonly explanation?: string;
  }[];
  readonly constraints: readonly string[];
  readonly difficulty?: 'Easy' | 'Medium' | 'Hard';
  readonly rawText: string;
}

export interface AnswerContext {
  /** The interviewer's question, verbatim from Deepgram `transcript.final`. */
  question: string;
  /** Recent transcript window (~last 90 s) for contextual grounding. */
  transcriptWindow?: string;
  /** User's resume text, if uploaded. Empty string if none. */
  resume?: string;
  /** Job description text, if pasted. Empty string if none. */
  jobDescription?: string;
  /** Language code (ISO-639 or BCP-47) for the answer. Defaults to 'en'. */
  language?: string;
  /** Question-detector hint, if available. Drives prompt-pack selection. */
  hint?: AnswerMode;
  /** Hint appended by the banned-words retry logic. Null on first attempt. */
  retryHint?: string | null;
  /**
   * Structured coding problem extracted from an OCR pass. Present when the candidate has
   * taken a screenshot of a LeetCode / HackerRank page. The coding prompt pack honors
   * title, description, examples, and constraints verbatim.
   */
  codingProblem?: CodingProblemLike;
  /**
   * The most recently completed Q/A pair, if any. Present so follow-up questions like
   * "What was the outcome?" or "Why?" have an anchor — without it the LLM hallucinates
   * a fresh story and the follow-up reads as incoherent.
   *
   * The orchestrator sets this before calling `startStream`; it's cleared when a newer
   * full-scope question arrives (detected by length + lack of follow-up markers) so
   * unrelated questions don't get dragged into each other's context.
   */
  priorTurn?: {
    readonly question: string;
    readonly answer: string;
  };
  /**
   * Phase 13d. Free-form candidate-supplied bias ("emphasize leadership examples",
   * "target Google SWE L6", "answer in Hindi"). Rendered as a prominent directive in
   * the user message so the model treats it as a hard constraint, not flavor text.
   * Empty / missing means "no extra instructions" — same as pre-13d behavior.
   */
  extraInstructions?: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: ProviderName;
  /**
   * Start a streaming completion. Yields text deltas until the stream ends or is aborted.
   */
  stream(ctx: AnswerContext, opts?: StreamOptions): AsyncGenerator<string, void, void>;
}

export interface LlmError {
  code: 'AUTH' | 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'UPSTREAM' | 'ABORTED' | 'UNKNOWN';
  message: string;
  statusCode?: number;
  providerName: ProviderName;
  cause?: unknown;
}

export class AnswerAbortedError extends Error {
  constructor(reason: 'newer_question' | 'user_abort' | 'shutdown') {
    super(`answer aborted: ${reason}`);
    this.name = 'AnswerAbortedError';
    this.reason = reason;
  }
  readonly reason: 'newer_question' | 'user_abort' | 'shutdown';
}
