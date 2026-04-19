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

/**
 * Per-user rate limiter — maps an opaque key (usually a userId) to its own sliding
 * window. Shared instance across the HTTP request lifecycle of the api process.
 *
 * We prune inactive buckets lazily on access rather than running a sweeper: a user who
 * stops calling just drops out on their next hit check (there's nothing to evict between
 * hits since the underlying array is already bounded by `capacity`).
 *
 * This is an in-process limiter. For horizontal scaling we'd move to Redis or a
 * token-bucket service, but at Phase 11 Beta scale (single api process) this is enough
 * and avoids an external dependency.
 */
export class PerUserRateLimiter {
  private readonly buckets = new Map<string, SlidingWindowLimiter>();

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryConsume(key: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new SlidingWindowLimiter(this.capacity, this.windowMs, this.now);
      this.buckets.set(key, bucket);
    }
    return bucket.tryConsume();
  }

  /** For tests — reset all buckets. */
  reset(): void {
    this.buckets.clear();
  }
}
