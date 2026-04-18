/**
 * Top-level parse entrypoint — detect the site, dispatch to the right parser. Falls back to
 * a generic extraction when we can't place the source. The coding prompt pack handles
 * sparse input gracefully, so returning an `unknown` CodingProblem with just the rawText
 * is always better than failing.
 */
import type { CodingProblem } from '../types';
import { detectSite } from './detect-site';
import { parseLeetcode } from './leetcode';
import { parseHackerRank } from './hackerrank';

export { detectSite, parseLeetcode, parseHackerRank };

export function parseCodingProblem(rawText: string): CodingProblem {
  const site = detectSite(rawText);
  if (site === 'leetcode') return parseLeetcode(rawText);
  if (site === 'hackerrank') return parseHackerRank(rawText);
  return {
    site: 'unknown',
    examples: [],
    constraints: [],
    rawText,
  };
}
