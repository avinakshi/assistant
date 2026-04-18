/**
 * HackerRank layout parser.
 *
 * Structure is distinct from LeetCode — HR leads with a title bar, a "Problem" body, then
 * fixed sections in order: Input Format, Constraints, Output Format, Sample Input, Sample
 * Output, Explanation.
 *
 * We extract:
 *   - title (first non-trivial heading line)
 *   - description (the "Problem" body)
 *   - a single CodingProblemExample assembled from Sample Input + Sample Output + Explanation
 *   - constraints list (from the "Constraints" section)
 */
import type { CodingProblem, CodingProblemExample } from '../types';
import { parseConstraints } from './leetcode';

// Header anchors — tolerant of missing colons and stray whitespace.
// IMPORTANT: use [ \t] (intra-line whitespace) rather than \s. \s includes \n, so
// `\s*$` with the /m flag greedily consumes newlines + following lines — a header match
// like /^\s*sample\s+output\s*$/im on "Sample Output\n15\n" matches the whole 2-line span.
const H_PROBLEM = /^[ \t]*problem[ \t]*$/im;
const H_INPUT_FMT = /^[ \t]*input[ \t]+format[ \t]*$/im;
const H_OUTPUT_FMT = /^[ \t]*output[ \t]+format[ \t]*$/im;
const H_CONSTRAINTS = /^[ \t]*constraints[ \t]*$/im;
const H_SAMPLE_IN = /^[ \t]*sample[ \t]+input(?:[ \t]+\d+)?[ \t]*$/im;
const H_SAMPLE_OUT = /^[ \t]*sample[ \t]+output(?:[ \t]+\d+)?[ \t]*$/im;
const H_EXPLANATION = /^[ \t]*explanation[ \t]*$/im;

export function parseHackerRank(rawText: string): CodingProblem {
  const title = extractTitle(rawText);
  const description = extractSection(rawText, H_PROBLEM, [H_INPUT_FMT, H_CONSTRAINTS, H_SAMPLE_IN]);
  const constraintsBlock = extractSection(rawText, H_CONSTRAINTS, [H_OUTPUT_FMT, H_SAMPLE_IN]);
  const constraints = parseConstraints(constraintsBlock);

  const sampleInput = extractSection(rawText, H_SAMPLE_IN, [H_SAMPLE_OUT, H_EXPLANATION]);
  const sampleOutput = extractSection(rawText, H_SAMPLE_OUT, [H_EXPLANATION]);
  const explanation = extractSection(rawText, H_EXPLANATION, []);

  const examples: CodingProblemExample[] = [];
  if (sampleInput || sampleOutput || explanation) {
    examples.push({
      ...(sampleInput ? { input: sampleInput } : {}),
      ...(sampleOutput ? { output: sampleOutput } : {}),
      ...(explanation ? { explanation } : {}),
    });
  }

  const result: CodingProblem = {
    site: 'hackerrank',
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    examples,
    constraints,
    rawText,
  };
  return result;
}

function extractTitle(text: string): string | undefined {
  // The title is typically the first non-empty line before any recognized section header.
  const firstHeader = text.search(H_PROBLEM);
  const searchZone = firstHeader >= 0 ? text.slice(0, firstHeader) : text.slice(0, 500);
  for (const line of searchZone.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(hackerrank|login|sign\s*up)/i.test(trimmed)) continue;
    if (trimmed.length > 2 && trimmed.length < 120) return trimmed;
  }
  return undefined;
}

/**
 * Slice text between a start header and the first of a set of end headers (whichever
 * comes first AFTER the start). Walks line-by-line from the start, which is more
 * predictable than running each end regex over the full text — multiline + case-insensitive
 * flags can pick up surprising earlier matches and mis-set `bodyEnd`.
 */
function extractSection(text: string, start: RegExp, ends: RegExp[]): string {
  const startMatch = start.exec(text);
  if (!startMatch) return '';
  const bodyStart = startMatch.index + startMatch[0].length;

  // Build single-line variants of the end regexes — we'll test each line directly.
  const lineMatchers = ends.map((re) => new RegExp(re.source, re.flags.replace('m', '')));

  const remaining = text.slice(bodyStart);
  const lines = remaining.split(/\r?\n/);
  const collected: string[] = [];
  for (const line of lines) {
    if (lineMatchers.some((re) => re.test(line))) break;
    collected.push(line);
  }

  return collected
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}
