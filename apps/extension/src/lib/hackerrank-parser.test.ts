import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractHackerRankProblem } from './hackerrank-parser';

function dom(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('extractHackerRankProblem', () => {
  it('returns null when no title is found', () => {
    expect(extractHackerRankProblem(dom('<body><div>nothing</div></body>'))).toBeNull();
  });

  it('extracts title via the data-attr1 hint', () => {
    const doc = dom('<body><div data-attr1="challenge-name">Diagonal Difference</div></body>');
    expect(extractHackerRankProblem(doc)?.title).toBe('Diagonal Difference');
  });

  it('falls back to <title> and strips "| HackerRank" suffix', () => {
    const doc = dom('<head><title>Compare Triplets | HackerRank</title></head><body></body>');
    expect(extractHackerRankProblem(doc)?.title).toBe('Compare Triplets');
  });

  it('extracts difficulty via pill text', () => {
    const doc = dom(`<body>
      <div data-attr1="challenge-name">Plus Minus</div>
      <span class="difficulty-easy">Easy</span>
    </body>`);
    expect(extractHackerRankProblem(doc)?.difficulty).toBe('Easy');
  });

  it('extracts slug from URL', () => {
    const doc = dom('<body><h1>Any Title</h1></body>');
    const out = extractHackerRankProblem(doc, 'https://www.hackerrank.com/challenges/diagonal-difference/problem');
    expect(out?.slug).toBe('diagonal-difference');
  });

  it('pulls body text from .challenge-body-html', () => {
    const doc = dom(`<body>
      <h1>Plus Minus</h1>
      <div class="challenge-body-html">
        Given an array of integers, calculate the ratios of its elements.
        Sample Input:
        5
      </div>
    </body>`);
    expect(extractHackerRankProblem(doc)?.rawText).toContain('Given an array of integers');
  });
});
