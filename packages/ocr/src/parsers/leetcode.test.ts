import { describe, expect, it } from 'vitest';
import { parseLeetcode } from './leetcode';
import { detectSite } from './detect-site';

const TWO_SUM = `
1. Two Sum
Easy

Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.
You may assume that each input would have exactly one solution, and you may not use the same element twice.
You can return the answer in any order.

Example 1:
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].

Example 2:
Input: nums = [3,2,4], target = 6
Output: [1,2]

Constraints:
2 <= nums.length <= 10^4
-10^9 <= nums[i] <= 10^9
-10^9 <= target <= 10^9
Only one valid answer exists.

Follow-up: Can you come up with an algorithm that is less than O(n^2) time complexity?
`;

describe('leetcode parser', () => {
  const p = parseLeetcode(TWO_SUM);

  it('marks site as leetcode', () => {
    expect(p.site).toBe('leetcode');
  });

  it('extracts title without the numeric prefix', () => {
    expect(p.title).toBe('Two Sum');
  });

  it('extracts difficulty', () => {
    expect(p.difficulty).toBe('Easy');
  });

  it('extracts the description without leaking title or difficulty', () => {
    expect(p.description).toBeTruthy();
    expect(p.description).not.toMatch(/1\. Two Sum/);
    expect(p.description).not.toMatch(/^Easy$/m);
    expect(p.description).toContain('integers nums and an integer target');
  });

  it('parses both examples with input, output, explanation where present', () => {
    expect(p.examples).toHaveLength(2);
    expect(p.examples[0]?.input).toBe('nums = [2,7,11,15], target = 9');
    expect(p.examples[0]?.output).toBe('[0,1]');
    expect(p.examples[0]?.explanation).toContain('nums[0] + nums[1] == 9');
    expect(p.examples[1]?.input).toBe('nums = [3,2,4], target = 6');
    expect(p.examples[1]?.output).toBe('[1,2]');
  });

  it('parses the constraints list', () => {
    expect(p.constraints).toContain('2 <= nums.length <= 10^4');
    expect(p.constraints).toContain('-10^9 <= nums[i] <= 10^9');
    expect(p.constraints).toContain('Only one valid answer exists.');
  });

  it('excludes follow-up content from constraints', () => {
    expect(p.constraints.join('\n')).not.toMatch(/Follow-up/);
  });

  it('preserves rawText for downstream fallback', () => {
    expect(p.rawText).toBe(TWO_SUM);
  });
});

describe('leetcode parser — edge cases', () => {
  it('tolerates OCR that dropped the difficulty pill', () => {
    const text = `
1. Valid Parentheses

Given a string s, determine if it is valid.

Example 1:
Input: s = "()"
Output: true

Constraints:
1 <= s.length <= 10^4
`;
    const p = parseLeetcode(text);
    expect(p.title).toBe('Valid Parentheses');
    expect(p.difficulty).toBeUndefined();
    expect(p.examples).toHaveLength(1);
  });

  it('returns empty arrays when examples/constraints are missing', () => {
    const text = `
42. Trapping Rain Water
Hard

Given n non-negative integers representing an elevation map, compute how much water it can trap after raining.
`;
    const p = parseLeetcode(text);
    expect(p.examples).toEqual([]);
    expect(p.constraints).toEqual([]);
    expect(p.title).toBe('Trapping Rain Water');
    expect(p.difficulty).toBe('Hard');
  });
});

describe('detectSite', () => {
  it('flags LeetCode OCR text', () => {
    expect(detectSite(TWO_SUM)).toBe('leetcode');
  });
});
