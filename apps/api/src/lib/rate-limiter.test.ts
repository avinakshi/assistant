import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './rate-limiter';

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
