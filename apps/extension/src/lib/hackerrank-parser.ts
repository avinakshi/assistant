/**
 * HackerRank DOM parser. Mirrors the LeetCode parser's output shape so the popup +
 * api code path can handle either site identically.
 *
 * HackerRank's challenge pages use a `.challenge_problem_statement` wrapper or the
 * newer `[data-test="challenge-body"]` attribute depending on the theme. Difficulty
 * appears as a `.difficulty-*` span. Constraints and samples are usually nested inside
 * the same problem-statement wrapper.
 */
import type { ExtractedProblem } from './leetcode-parser';
import { splitBody } from './leetcode-parser';

export function extractHackerRankProblem(doc: Document, url?: string): ExtractedProblem | null {
  const title = findTitle(doc);
  if (!title) return null;

  const difficulty = findDifficulty(doc);
  const body = findBody(doc);
  const rawText = body ? collapse(body.textContent ?? '') : '';
  const { description, examples, constraints } = splitBody(rawText);
  const slug = extractSlug(url);

  return {
    title,
    ...(difficulty ? { difficulty } : {}),
    description,
    examples,
    constraints,
    ...(slug ? { slug } : {}),
    rawText,
  };
}

function findTitle(doc: Document): string {
  const candidates = [
    doc.querySelector('[data-attr1="challenge-name"]'),
    doc.querySelector('.challenge-body-html h1'),
    doc.querySelector('.hr_tour-challenge-name'),
    doc.querySelector('.challenge_problem_statement h1'),
    doc.querySelector('header h1'),
    doc.querySelector('h1'),
    doc.querySelector('title'),
  ];
  for (const el of candidates) {
    const raw = el?.textContent?.trim();
    if (!raw) continue;
    const cleaned = raw
      .replace(/\s*\|\s*HackerRank\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > 0) return cleaned;
  }
  return '';
}

function findDifficulty(doc: Document): ExtractedProblem['difficulty'] {
  // HackerRank shows difficulty as "Easy"/"Medium"/"Hard" in a pill next to the title.
  // Match by exact text to survive class renames.
  const all = doc.querySelectorAll('span, div');
  for (const el of all) {
    const text = el.textContent?.trim();
    if (text === 'Easy' || text === 'Medium' || text === 'Hard') return text;
  }
  return undefined;
}

function findBody(doc: Document): Element | null {
  return (
    doc.querySelector('[data-test="challenge-body"]') ||
    doc.querySelector('.challenge-body-html') ||
    doc.querySelector('.challenge_problem_statement') ||
    doc.querySelector('article') ||
    doc.querySelector('main')
  );
}

function extractSlug(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/challenges\/([a-z0-9-]+)/i);
  return m ? m[1] : undefined;
}

function collapse(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}
