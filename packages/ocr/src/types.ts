/**
 * Shared OCR + CodingProblem types.
 *
 * `CodingProblem` is the structured output we hand to the LLM — the whole point of the
 * screen-OCR pipeline. It's intentionally permissive: every field except `rawText` is
 * optional, because OCR parsers will occasionally fail to extract one section. The coding
 * prompt pack knows to degrade gracefully when constraints or examples are missing.
 */

export interface CodingProblemExample {
  readonly input?: string;
  readonly output?: string;
  readonly explanation?: string;
}

export interface CodingProblem {
  /** Where we think the problem came from. Useful for telemetry + prompt steering. */
  readonly site: 'leetcode' | 'hackerrank' | 'unknown';
  /** Section title ("1. Two Sum"), stripped of the numeric prefix if present. */
  readonly title?: string;
  /** Problem statement body as extracted from OCR text. Markdown-ish; may contain artifacts. */
  readonly description?: string;
  readonly examples: readonly CodingProblemExample[];
  readonly constraints: readonly string[];
  /** LeetCode difficulty chip if parseable: 'Easy' | 'Medium' | 'Hard'. */
  readonly difficulty?: 'Easy' | 'Medium' | 'Hard';
  /** The OCR text we started from. Useful fallback when parsing misfires. */
  readonly rawText: string;
}

export interface OcrResult {
  /** Plain text concatenated from Vision's full_text_annotation. */
  readonly text: string;
  /** Sha256 of the PNG we processed. Callers key caches on this. */
  readonly sha256: string;
}
