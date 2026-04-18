import { describe, expect, it } from 'vitest';
import { InMemoryOcrCache } from './ocr-cache';
import type { CodingProblem } from '@repo/ocr';

function problem(title = 'Two Sum'): CodingProblem {
  return { site: 'leetcode', title, examples: [], constraints: [], rawText: title };
}

describe('InMemoryOcrCache', () => {
  it('stores and retrieves by sha256 key', () => {
    const cache = new InMemoryOcrCache();
    cache.set('abc', problem('Two Sum'));
    expect(cache.get('abc')?.title).toBe('Two Sum');
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the oldest when over maxEntries', () => {
    const cache = new InMemoryOcrCache(2);
    cache.set('a', problem('A'));
    cache.set('b', problem('B'));
    cache.set('c', problem('C'));
    expect(cache.get('a')).toBeUndefined(); // evicted
    expect(cache.get('b')?.title).toBe('B');
    expect(cache.get('c')?.title).toBe('C');
  });

  it('treats entries past TTL as missing and cleans them up', () => {
    let now = 0;
    const cache = new InMemoryOcrCache(100, 1000, () => now);
    cache.set('k', problem('K'));
    now = 500;
    expect(cache.get('k')?.title).toBe('K');
    now = 1500;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('touching an entry refreshes its LRU position', () => {
    const cache = new InMemoryOcrCache(2);
    cache.set('a', problem('A'));
    cache.set('b', problem('B'));
    // Touch a → b becomes the oldest.
    cache.get('a');
    cache.set('c', problem('C'));
    expect(cache.get('a')?.title).toBe('A');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')?.title).toBe('C');
  });
});
