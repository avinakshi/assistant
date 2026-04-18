/**
 * STT router — Deepgram primary, AssemblyAI fallback.
 *
 * Failover rule (per spec): if Deepgram returns 3 consecutive 5xx inside a 60 s rolling
 * window, switch the whole session to AssemblyAI for the remainder.
 *
 * We track failures at *session start* — if the initial connect fails with UPSTREAM_5XX
 * enough times, the next connect is routed to AssemblyAI. Per-message failures during an
 * active session are handled by the session orchestrator itself (reconnect with backoff);
 * this router only controls which provider is chosen for a fresh connect.
 */
import type { SttConnectOptions, SttError, SttProvider, SttSession } from './provider';

export interface SttRouterDeps {
  primary: SttProvider;
  fallback: SttProvider;
  now?: () => number;
  /** Override for tests — spec default is 3 5xx inside 60 s triggers failover. */
  failureThreshold?: number;
  failureWindowMs?: number;
}

export class SttRouter {
  private readonly failures: number[] = [];
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly windowMs: number;

  constructor(private readonly deps: SttRouterDeps) {
    this.now = deps.now ?? Date.now;
    this.threshold = deps.failureThreshold ?? 3;
    this.windowMs = deps.failureWindowMs ?? 60_000;
  }

  get currentProviderName(): string {
    return this.shouldUseFallback() ? this.deps.fallback.name : this.deps.primary.name;
  }

  async connect(opts: SttConnectOptions): Promise<SttSession> {
    const useFallback = this.shouldUseFallback();
    const provider = useFallback ? this.deps.fallback : this.deps.primary;

    // One failure per attempt, regardless of how many error paths fire (onError callback
    // AND thrown rejection both count as "this attempt was unhealthy").
    let recordedForThisAttempt = false;
    const recordOnce = (err: SttError): void => {
      if (recordedForThisAttempt || useFallback) return;
      recordedForThisAttempt = true;
      this.recordFailure(err);
    };

    try {
      return await provider.connect({
        ...opts,
        onError: (err) => {
          recordOnce(err);
          opts.onError(err);
        },
      });
    } catch (err) {
      recordOnce(toSttError(err));
      throw err;
    }
  }

  private recordFailure(err: SttError): void {
    if (err.code !== 'UPSTREAM_5XX' && err.code !== 'NETWORK') return;
    const now = this.now();
    this.failures.push(now);
    // Drop anything outside the rolling window.
    while (this.failures.length > 0 && now - this.failures[0]! > this.windowMs) {
      this.failures.shift();
    }
  }

  private shouldUseFallback(): boolean {
    const cutoff = this.now() - this.windowMs;
    const recent = this.failures.filter((t) => t >= cutoff);
    return recent.length >= this.threshold;
  }
}

function toSttError(err: unknown): SttError {
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'NETWORK', message, cause: err };
}
