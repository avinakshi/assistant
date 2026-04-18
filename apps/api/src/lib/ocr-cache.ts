/**
 * In-memory LRU cache for OCR results, keyed by SHA256(png).
 *
 * Phase 5 scope uses in-memory because Redis lands in Phase 6 (via Upstash). When we wire
 * Redis, replace the underlying Map with a redis client and keep the same Cache interface —
 * no caller changes.
 *
 * Defaults: 100 entries, 1 hour TTL. Screenshots of the same problem within a session hit
 * the cache; each new problem evicts the oldest.
 */
import type { CodingProblem } from '@repo/ocr';

export interface OcrCache {
  get(sha256: string): CodingProblem | undefined;
  set(sha256: string, problem: CodingProblem): void;
  size(): number;
}

interface Entry {
  problem: CodingProblem;
  insertedAt: number;
}

export class InMemoryOcrCache implements OcrCache {
  private readonly map = new Map<string, Entry>();
  constructor(
    private readonly maxEntries = 100,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  get(sha256: string): CodingProblem | undefined {
    const entry = this.map.get(sha256);
    if (!entry) return undefined;
    if (this.now() - entry.insertedAt > this.ttlMs) {
      this.map.delete(sha256);
      return undefined;
    }
    // Touch: move to end for LRU.
    this.map.delete(sha256);
    this.map.set(sha256, entry);
    return entry.problem;
  }

  set(sha256: string, problem: CodingProblem): void {
    if (this.map.has(sha256)) this.map.delete(sha256);
    this.map.set(sha256, { problem, insertedAt: this.now() });
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  size(): number {
    return this.map.size;
  }
}
