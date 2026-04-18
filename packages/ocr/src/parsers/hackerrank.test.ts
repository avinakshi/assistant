import { describe, expect, it } from 'vitest';
import { parseHackerRank } from './hackerrank';
import { detectSite } from './detect-site';

const DIAG_DIFF = `
Diagonal Difference

Problem

Given a square matrix, calculate the absolute difference between the sums of its diagonals.

Input Format
The first line contains a single integer, n, the number of rows and columns in the square matrix arr.
Each of the next n lines describes a row, arr[i], and consists of n space-separated integers.

Constraints
-100 <= arr[i][j] <= 100
1 <= n <= 10

Output Format
Print the absolute difference between the sums of the matrix's two diagonals.

Sample Input
3
11 2 4
4 5 6
10 8 -12

Sample Output
15

Explanation
The primary diagonal sum is 11 + 5 + (-12) = 4. The secondary is 4 + 5 + 10 = 19. The difference is |4 - 19| = 15.
`;

describe('hackerrank parser', () => {
  const p = parseHackerRank(DIAG_DIFF);

  it('marks site as hackerrank', () => {
    expect(p.site).toBe('hackerrank');
  });

  it('extracts the title from the banner', () => {
    expect(p.title).toBe('Diagonal Difference');
  });

  it('extracts the description body under the Problem header', () => {
    expect(p.description).toContain('square matrix');
    expect(p.description).toContain('absolute difference');
    expect(p.description).not.toMatch(/Input Format/i);
  });

  it('parses constraints', () => {
    expect(p.constraints).toContain('-100 <= arr[i][j] <= 100');
    expect(p.constraints).toContain('1 <= n <= 10');
  });

  it('assembles one example from Sample Input / Output / Explanation', () => {
    expect(p.examples).toHaveLength(1);
    const ex = p.examples[0]!;
    expect(ex.input).toContain('11 2 4');
    expect(ex.output).toBe('15');
    expect(ex.explanation).toContain('primary diagonal sum');
  });
});

describe('detectSite', () => {
  it('flags HackerRank OCR text', () => {
    expect(detectSite(DIAG_DIFF)).toBe('hackerrank');
  });
});
