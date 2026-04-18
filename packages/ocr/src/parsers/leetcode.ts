/**
 * LeetCode layout parser.
 *
 * Operates on plain text from Google Vision. LeetCode's rendered HTML has a predictable
 * enough structure that regex-based parsing beats running a full DOM parser over noisy OCR.
 *
 * Typical LeetCode problem layout we see after OCR:
 *
 *   1. Two Sum
 *   Easy
 *   Given an array of integers nums and an integer target, return indices of the two
 *   numbers such that they add up to target.
 *   You may assume that each input would have exactly one solution...
 *
 *   Example 1:
 *   Input: nums = [2,7,11,15], target = 9
 *   Output: [0,1]
 *   Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].
 *
 *   Example 2:
 *   ...
 *
 *   Constraints:
 *   2 <= nums.length <= 10^4
 *   -10^9 <= nums[i] <= 10^9
 *   ...
 *
 * Parsers tolerate OCR noise: missing colons, weird whitespace, stray "Submissions" pills.
 */
import type { CodingProblem, CodingProblemExample } from '../types';

const TITLE_RE = /^\s*(\d+)\.\s+(.+?)\s*$/m;
const DIFFICULTY_RE = /^\s*(Easy|Medium|Hard)\s*$/im;

export function parseLeetcode(rawText: string): CodingProblem {
  const title = extractTitle(rawText);
  const difficulty = extractDifficulty(rawText);
  const { description, examplesBlock, constraintsBlock } = splitSections(rawText);
  const examples = parseExamples(examplesBlock);
  const constraints = parseConstraints(constraintsBlock);

  const result: CodingProblem = {
    site: 'leetcode',
    ...(title ? { title } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(description ? { description } : {}),
    examples,
    constraints,
    rawText,
  };
  return result;
}

function extractTitle(text: string): string | undefined {
  const m = TITLE_RE.exec(text);
  if (!m) return undefined;
  return m[2]?.trim();
}

function extractDifficulty(text: string): 'Easy' | 'Medium' | 'Hard' | undefined {
  const m = DIFFICULTY_RE.exec(text);
  if (!m) return undefined;
  const raw = m[1];
  if (raw === 'Easy' || raw === 'Medium' || raw === 'Hard') return raw;
  return undefined;
}

/**
 * Splits the OCR text into description / examples / constraints sections. Section headers
 * are the most reliable anchors.
 */
function splitSections(text: string): {
  description: string;
  examplesBlock: string;
  constraintsBlock: string;
} {
  // Find the first "Example N:" header. Use [ \t] not \s — see note in hackerrank.ts.
  const exampleHeader = /^[ \t]*example[ \t]+\d+[ \t]*:?[ \t]*$/im.exec(text);
  const constraintHeader = /^[ \t]*constraints[ \t]*:?[ \t]*$/im.exec(text);

  // Follow-up sections appear either on their own line ("Follow-up") or as a prefix with
  // content ("Follow-up: Can you ..."). Match the keyword + required colon; don't anchor
  // to end-of-line or we miss the inline form.
  const followUpHeader =
    /^[ \t]*(follow\s*-?\s*up|hints?|related\s+topics?|similar\s+questions?|topics)\s*:/im.exec(
      text,
    );

  const descriptionEnd = exampleHeader?.index ?? constraintHeader?.index ?? text.length;
  const examplesStart = exampleHeader?.index;
  const examplesEnd = constraintHeader?.index ?? followUpHeader?.index ?? text.length;
  const constraintsStart = constraintHeader ? constraintHeader.index + constraintHeader[0].length : -1;
  const constraintsEnd = followUpHeader?.index ?? text.length;

  const descriptionRaw = text.slice(0, descriptionEnd);
  const description = stripTitleAndDifficulty(descriptionRaw);

  const examplesBlock =
    examplesStart !== undefined && examplesEnd > examplesStart
      ? text.slice(examplesStart, examplesEnd)
      : '';

  const constraintsBlock =
    constraintsStart !== -1 && constraintsEnd > constraintsStart
      ? text.slice(constraintsStart, constraintsEnd)
      : '';

  return { description, examplesBlock, constraintsBlock };
}

function stripTitleAndDifficulty(text: string): string {
  return text
    .replace(TITLE_RE, '')
    .replace(DIFFICULTY_RE, '')
    // Drop the "Submissions / Accepted" run that LeetCode shows under the title pill.
    .replace(/^(?:accepted|submissions|runtime|memory)[^\n]*$/gim, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}

/**
 * Parse an "Example 1: / Example 2: ..." block.
 * Each example typically has Input / Output / Explanation lines.
 */
export function parseExamples(block: string): CodingProblemExample[] {
  if (!block.trim()) return [];
  // Split on "Example N:" markers, keeping content between them.
  const parts = block.split(/^[ \t]*example[ \t]+\d+[ \t]*:?[ \t]*$/gim);
  const out: CodingProblemExample[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const ex = parseSingleExample(trimmed);
    if (ex.input || ex.output || ex.explanation) out.push(ex);
  }
  return out;
}

function parseSingleExample(block: string): CodingProblemExample {
  // Label-based split. We look for "Input:", "Output:", "Explanation:" on their own line
  // (or inline). OCR often drops the colon or merges with next word, so be generous.
  const labels: ('input' | 'output' | 'explanation')[] = ['input', 'output', 'explanation'];
  const sections: Record<string, string> = {};
  let currentLabel: string | null = null;
  let currentLines: string[] = [];

  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const labelMatch = /^\s*(input|output|explanation)\s*:?\s*(.*)$/i.exec(line);
    if (labelMatch && labels.includes(labelMatch[1]!.toLowerCase() as 'input')) {
      if (currentLabel) sections[currentLabel] = currentLines.join('\n').trim();
      currentLabel = labelMatch[1]!.toLowerCase();
      currentLines = [];
      const rest = labelMatch[2] ?? '';
      if (rest.trim()) currentLines.push(rest);
    } else if (currentLabel) {
      currentLines.push(line);
    }
  }
  if (currentLabel) sections[currentLabel] = currentLines.join('\n').trim();

  const ex: CodingProblemExample = {
    ...(sections['input'] ? { input: sections['input'] } : {}),
    ...(sections['output'] ? { output: sections['output'] } : {}),
    ...(sections['explanation'] ? { explanation: sections['explanation'] } : {}),
  };
  return ex;
}

export function parseConstraints(block: string): string[] {
  if (!block.trim()) return [];
  return block
    .split(/\r?\n/)
    // Only strip bullets when followed by whitespace. Without that guard, the leading "-"
    // in "-10^9 <= nums[i] <= 10^9" is mistaken for a bullet character.
    .map((l) => l.replace(/^[ \t]*([-•·*])[ \t]+/, '').trim())
    .filter((l) => l.length > 0);
}
