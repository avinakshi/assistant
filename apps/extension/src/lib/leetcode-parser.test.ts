import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractLeetCodeProblem, splitBody } from './leetcode-parser';

/**
 * The parser operates on a Document (not on the live LeetCode DOM), so we mock with
 * jsdom + canned HTML fixtures that mirror LeetCode's structure. Keep the fixtures
 * minimal — only the selectors + text the parser reads from.
 */

function domWith(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('extractLeetCodeProblem', () => {
  it('returns null when no title can be found', () => {
    const doc = domWith('<html><body><div>nothing relevant</div></body></html>');
    expect(extractLeetCodeProblem(doc)).toBeNull();
  });

  it('extracts title via data-cy attribute', () => {
    const doc = domWith('<body><div data-cy="question-title">1. Two Sum</div></body>');
    const out = extractLeetCodeProblem(doc);
    expect(out?.title).toBe('1. Two Sum');
  });

  it('falls back to <title> tag and strips "- LeetCode" suffix', () => {
    const doc = domWith('<head><title>1. Two Sum - LeetCode</title></head><body></body>');
    expect(extractLeetCodeProblem(doc)?.title).toBe('1. Two Sum');
  });

  it('extracts difficulty from any small pill with Easy/Medium/Hard text', () => {
    const doc = domWith(`<body>
      <div data-cy="question-title">2. Add Two Numbers</div>
      <span class="some-pill">Medium</span>
    </body>`);
    expect(extractLeetCodeProblem(doc)?.difficulty).toBe('Medium');
  });

  it('extracts slug from the URL when provided', () => {
    const doc = domWith('<body><div data-cy="question-title">1. Two Sum</div></body>');
    const out = extractLeetCodeProblem(doc, 'https://leetcode.com/problems/two-sum/description');
    expect(out?.slug).toBe('two-sum');
  });

  it('pulls rawText from the problem-content container when present', () => {
    const doc = domWith(`<body>
      <div data-cy="question-title">1. Two Sum</div>
      <div data-track-load="description_content">
        Given an array of integers nums and an integer target.
        Example 1:
        Input: nums = [2,7], target = 9
        Output: [0,1]
      </div>
    </body>`);
    const out = extractLeetCodeProblem(doc);
    expect(out?.rawText).toContain('Given an array of integers');
    expect(out?.rawText).toContain('Example 1:');
  });
});

describe('splitBody', () => {
  it('splits description + example + constraints from a typical LeetCode body', () => {
    const body = `Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.
You may assume that each input would have exactly one solution.

Example 1:
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: Because nums[0] + nums[1] == 9.

Example 2:
Input: nums = [3,2,4], target = 6
Output: [1,2]

Constraints:
2 <= nums.length <= 10^4
-10^9 <= nums[i] <= 10^9

Follow-up: Can you come up with an algorithm better than O(n^2)?`;

    const out = splitBody(body);
    expect(out.description).toContain('Given an array');
    expect(out.description).not.toContain('Example');
    expect(out.examples.length).toBe(2);
    expect(out.examples[0]!.input).toBe('nums = [2,7,11,15], target = 9');
    expect(out.examples[0]!.output).toBe('[0,1]');
    expect(out.examples[0]!.explanation).toContain('Because nums[0]');
    expect(out.examples[1]!.input).toBe('nums = [3,2,4], target = 6');
    expect(out.constraints).toEqual(['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9']);
  });

  it('handles negative-leading constraints without eating the minus sign', () => {
    const out = splitBody('Constraints:\n-10^9 <= x <= 10^9');
    expect(out.constraints).toEqual(['-10^9 <= x <= 10^9']);
  });

  it('strips bullet markers from constraints', () => {
    const out = splitBody('Constraints:\n\u2022 1 <= n <= 100\n* 0 <= k <= 10');
    expect(out.constraints).toEqual(['1 <= n <= 100', '0 <= k <= 10']);
  });

  it('returns empty arrays for an empty body', () => {
    const out = splitBody('');
    expect(out.description).toBe('');
    expect(out.examples).toEqual([]);
    expect(out.constraints).toEqual([]);
  });

  it('tolerates an Example block without explanation', () => {
    const body = `Do a thing.

Example 1:
Input: n = 5
Output: 25`;
    const out = splitBody(body);
    expect(out.examples.length).toBe(1);
    expect(out.examples[0]!.explanation).toBeUndefined();
  });
});
