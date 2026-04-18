/**
 * Token-bucket rate limiter for in-session OCR requests.
 *
 * Per-connection (not per-user; auth lands Phase 6). Default: 10 requests per rolling 60 s.
 * Rejects the 11th request within the window.
 *
 * Matches the spec in SPEC §5.7: "rate limit 10 OCR/min per user".
 */
export interface RateLimiter {
  tryConsume(): { allowed: true } | { allowed: false; retryAfterMs: number };
}

export class SlidingWindowLimiter implements RateLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly capacity = 10,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  tryConsume(): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const t = this.now();
    const cutoff = t - this.windowMs;
    while (this.hits.length > 0 && this.hits[0]! < cutoff) this.hits.shift();
    if (this.hits.length >= this.capacity) {
      const retryAfterMs = this.hits[0]! + this.windowMs - t;
      return { allowed: false, retryAfterMs: Math.max(1, retryAfterMs) };
    }
    this.hits.push(t);
    return { allowed: true };
  }
}
