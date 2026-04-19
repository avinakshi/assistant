import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter, PerUserRateLimiter } from './rate-limiter';

describe('SlidingWindowLimiter', () => {
  it('allows up to capacity in the window and rejects the next', () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowLimiter(3, 1000, () => now);
    expect(limiter.tryConsume().allowed).toBe(true);
    expect(limiter.tryConsume().allowed).toBe(true);
    expect(limiter.tryConsume().allowed).toBe(true);
    const denied = limiter.tryConsume();
    expect(denied.allowed).toBe(false);
    if (denied.allowed === false) {
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
    }
  });

  it('replenishes as old hits fall off the window', () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowLimiter(2, 1000, () => now);
    limiter.tryConsume();
    limiter.tryConsume();
    expect(limiter.tryConsume().allowed).toBe(false);
    now += 1100;
    expect(limiter.tryConsume().allowed).toBe(true);
  });
});

describe('PerUserRateLimiter', () => {
  it('isolates users — one user\u2019s hits don\u2019t count against another', () => {
    let now = 1_000_000;
    const l = new PerUserRateLimiter(2, 1000, () => now);
    // User A uses up quota.
    expect(l.tryConsume('a').allowed).toBe(true);
    expect(l.tryConsume('a').allowed).toBe(true);
    expect(l.tryConsume('a').allowed).toBe(false);
    // User B has their own fresh bucket.
    expect(l.tryConsume('b').allowed).toBe(true);
    expect(l.tryConsume('b').allowed).toBe(true);
    expect(l.tryConsume('b').allowed).toBe(false);
  });

  it('emits a retryAfterMs that respects the per-user window', () => {
    let now = 1_000_000;
    const l = new PerUserRateLimiter(1, 5000, () => now);
    l.tryConsume('a');
    const denied = l.tryConsume('a');
    expect(denied.allowed).toBe(false);
    if (denied.allowed === false) {
      expect(denied.retryAfterMs).toBeLessThanOrEqual(5000);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('reset() clears all per-user state', () => {
    let now = 1_000_000;
    const l = new PerUserRateLimiter(1, 5000, () => now);
    l.tryConsume('a');
    expect(l.tryConsume('a').allowed).toBe(false);
    l.reset();
    expect(l.tryConsume('a').allowed).toBe(true);
  });

  it('creates a new bucket the first time a user is seen', () => {
    const l = new PerUserRateLimiter(3, 1000);
    for (let i = 0; i < 50; i++) {
      expect(l.tryConsume(`user-${i}`).allowed).toBe(true);
    }
  });
});
