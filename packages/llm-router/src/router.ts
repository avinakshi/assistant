/**
 * LLM router — per-tier provider selection + racing + banned-word retry.
 *
 * Phase 4a scope: Gemini-only. Every tier (Free / Starter / Pro / Lifetime) routes here.
 * Phase 4b: Starter → Claude|GPT-4.1 user-choice, Pro → Auto (race Claude vs GPT-5),
 * Free → Gemini. The `selectProvider()` switch is the only code that changes.
 *
 * Retry flow for banned words:
 *   1. Open upstream stream, wrap in StreamFilter.
 *   2. Yield cleared chunks downstream.
 *   3. If filter throws BannedWordHit: abort this upstream, bump retry counter, re-request
 *      with amended `retryHint` instructing the model to avoid the offender.
 *   4. Max 2 retries. After 2, we stop filtering and emit raw deltas + log to observability
 *      so we can tune the prompt pack.
 */
import type {
  AnswerContext,
  LlmProvider,
  ProviderName,
  StreamOptions,
} from './provider';
import { AnswerAbortedError } from './provider';
import { BannedWordHit, createStreamFilter } from './banned-words';

export type Tier = 'free' | 'starter' | 'pro' | 'lifetime';

export interface RouterConfig {
  gemini?: LlmProvider;
  claude?: LlmProvider;
  gptPrimary?: LlmProvider; // gpt-5
  gptSecondary?: LlmProvider; // gpt-4.1
  /** Override banned-word lists in tests. */
  bannedWords?: readonly string[];
  bannedPhrases?: readonly string[];
  /** Emit telemetry. Defaults to no-op. */
  onEvent?: (ev: RouterEvent) => void;
}

export type RouterEvent =
  | { kind: 'answer.started'; provider: ProviderName; mode: string }
  | { kind: 'answer.done'; provider: ProviderName; chars: number; latencyMs: number }
  | { kind: 'banned.hit'; offender: string; attempt: number }
  | { kind: 'banned.exhausted'; offender: string }
  | { kind: 'fallback.claude_unavailable' };

export interface StreamRequest {
  tier: Tier;
  context: AnswerContext;
  /** User's chosen provider (paid tiers). 'auto' triggers Pro racing. */
  llm?: 'auto' | ProviderName;
  signal?: AbortSignal;
}

export interface StreamResult {
  provider: ProviderName;
  deltas: AsyncGenerator<string, void, void>;
}

const MAX_RETRIES = 2;

export class LlmRouter {
  constructor(private readonly config: RouterConfig) {}

  async startStream(req: StreamRequest): Promise<StreamResult> {
    const provider = this.selectProvider(req);
    const self = this;
    const deltas = async function* (): AsyncGenerator<string, void, void> {
      yield* self.streamWithRetry(provider, req);
    };
    return { provider: provider.name, deltas: deltas() };
  }

  /**
   * Gemini is the always-on default. Claude only fires when the client explicitly asks
   * for it (session.start `llm: 'claude'`) AND the provider is configured. This is a
   * budget safeguard — we don't auto-select a paid provider without an opt-in.
   *
   * GPT-5 / GPT-4.1 slots are reserved for Phase 4b; falling through to Gemini until then.
   */
  private selectProvider(req: StreamRequest): LlmProvider {
    if (req.llm === 'claude' && this.config.claude) {
      return this.config.claude;
    }
    if (req.llm === 'claude' && !this.config.claude) {
      // User asked for Claude but it's not configured — fall back rather than 500.
      // Emit a telemetry event so we can spot "user expected Claude, got Gemini" drift.
      this.config.onEvent?.({ kind: 'fallback.claude_unavailable' });
    }
    if (!this.config.gemini) {
      throw new Error('LlmRouter: no Gemini provider configured');
    }
    return this.config.gemini;
  }

  private async *streamWithRetry(
    provider: LlmProvider,
    req: StreamRequest,
  ): AsyncGenerator<string, void, void> {
    const started = Date.now();
    let totalChars = 0;
    let attempt = 0;
    let lastOffender: string | null = null;
    let context: AnswerContext = req.context;

    this.config.onEvent?.({
      kind: 'answer.started',
      provider: provider.name,
      mode: context.hint ?? 'auto',
    });

    while (true) {
      const filter = createStreamFilter(this.config.bannedWords, this.config.bannedPhrases);
      const opts: StreamOptions = req.signal ? { signal: req.signal } : {};
      const upstream = provider.stream(context, opts);
      let hit: BannedWordHit | null = null;

      try {
        for await (const delta of upstream) {
          try {
            const cleared = filter.push(delta);
            if (cleared.length > 0) {
              totalChars += cleared.length;
              yield cleared;
            }
          } catch (err) {
            if (err instanceof BannedWordHit) {
              hit = err;
              break;
            }
            throw err;
          }
        }
        if (!hit) {
          try {
            const tail = filter.flush();
            if (tail.length > 0) {
              totalChars += tail.length;
              yield tail;
            }
          } catch (err) {
            if (err instanceof BannedWordHit) hit = err;
            else throw err;
          }
        }
      } finally {
        // Generators returned by providers are cleanly closed when the for-await exits
        // early (break / throw). No extra teardown needed.
      }

      if (!hit) break;

      // Tell the upstream generator to stop producing; it should release its connection.
      await upstream.return?.();

      lastOffender = hit.offender;
      attempt += 1;
      this.config.onEvent?.({ kind: 'banned.hit', offender: hit.offender, attempt });

      if (attempt > MAX_RETRIES) {
        this.config.onEvent?.({ kind: 'banned.exhausted', offender: hit.offender });
        // Fall through: emit raw deltas from a final retry without filtering.
        const rawCtx: AnswerContext = {
          ...req.context,
          retryHint: `IMPORTANT: Your previous attempt used the banned word or phrase '${hit.offender}'. Regenerate from scratch, writing concisely without that word or any synonyms that carry corporate-speak connotation.`,
        };
        const rawOpts: StreamOptions = req.signal ? { signal: req.signal } : {};
        for await (const delta of provider.stream(rawCtx, rawOpts)) {
          totalChars += delta.length;
          yield delta;
        }
        break;
      }

      context = {
        ...req.context,
        retryHint: `IMPORTANT: Your previous attempt used the banned word or phrase '${hit.offender}'. Regenerate without it.`,
      };
    }

    if (lastOffender && attempt === 0) {
      // cannot happen — attempt is 0 only when no hit was encountered
    }

    this.config.onEvent?.({
      kind: 'answer.done',
      provider: provider.name,
      chars: totalChars,
      latencyMs: Date.now() - started,
    });
  }
}

/**
 * Convenience: drain an async iterable of deltas into one full string. Used by tests and
 * the benchmark script.
 */
export async function collectAnswer(
  deltas: AsyncGenerator<string, void, void>,
  signal?: AbortSignal,
): Promise<string> {
  let out = '';
  for await (const d of deltas) {
    if (signal?.aborted) throw new AnswerAbortedError('user_abort');
    out += d;
  }
  return out;
}
