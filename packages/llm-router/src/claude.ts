/**
 * Claude (Anthropic) streaming provider.
 *
 * Default model: `claude-haiku-4-5-20251001` — chosen for budget safety. Sonnet 4.6 is a
 * one-env-var flip when cost allows.
 *
 * Prompt caching: system prompt + resume + JD all carry `cache_control: ephemeral`. Expected
 * cache hit rate ≥ 85% within a session → ~10× cost cut on cached reads. First call in a
 * session pays full input cost; every call after is mostly cache hits.
 *
 * Budget discipline: this provider is **opt-in only** from the router. It never runs in tests,
 * benchmarks, or the auto-start path. Callers must explicitly pass `llm='claude'` in
 * `session.start` for a Claude stream to fire.
 */
import Anthropic from '@anthropic-ai/sdk';
import { promptFor, type PromptPackName } from '@repo/prompts';
import type {
  AnswerContext,
  AnswerMode,
  LlmProvider,
  ProviderName,
  StreamOptions,
} from './provider';
import { AnswerAbortedError } from './provider';
import { buildUserMessage } from './context-render';

export interface ClaudeConfig {
  apiKey: string;
  /** Defaults to claude-haiku-4-5-20251001. Set via CLAUDE_MODEL env. */
  model?: string;
  /** Test-only hook so integration tests can point at a fake server. */
  baseURL?: string;
}

export class ClaudeProvider implements LlmProvider {
  readonly name: ProviderName = 'claude';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: ClaudeConfig) {
    if (!config.apiKey) throw new Error('ClaudeProvider: apiKey is required');
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.model = config.model ?? 'claude-haiku-4-5-20251001';
  }

  async *stream(ctx: AnswerContext, opts: StreamOptions = {}): AsyncGenerator<string, void, void> {
    const signal = opts.signal;
    if (signal?.aborted) throw new AnswerAbortedError('user_abort');

    const pack: PromptPackName = hintToPack(ctx.hint ?? 'auto');
    const systemPrompt = promptFor(pack);

    // System array with cache_control on the stable blocks. Order matters — cached blocks
    // must come first so the prefix stays cacheable.
    const systemBlocks: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];
    if (ctx.resume && ctx.resume.length > 0) {
      systemBlocks.push({
        type: 'text',
        text: `<resume>\n${ctx.resume.trim()}\n</resume>`,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (ctx.jobDescription && ctx.jobDescription.length > 0) {
      systemBlocks.push({
        type: 'text',
        text: `<job_description>\n${ctx.jobDescription.trim()}\n</job_description>`,
        cache_control: { type: 'ephemeral' },
      });
    }

    // User message holds the volatile parts (transcript window, coding problem, question).
    // Static blocks (resume, JD) are already in `systemBlocks` under cache_control, so
    // buildUserMessage receives `includeStaticBlocks: false` to avoid duplication.
    const userContent = buildUserMessage(ctx, false);

    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 1024,
        temperature: 0.7,
        system: systemBlocks,
        messages: [{ role: 'user', content: userContent }],
      },
      signal ? { signal } : undefined,
    );

    try {
      for await (const event of stream) {
        if (signal?.aborted) throw new AnswerAbortedError('user_abort');
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta' &&
          event.delta.text.length > 0
        ) {
          yield event.delta.text;
        }
      }
    } catch (err) {
      if (signal?.aborted) throw new AnswerAbortedError('user_abort');
      throw err;
    }
  }
}

function hintToPack(mode: AnswerMode): PromptPackName {
  switch (mode) {
    case 'coding':
      return 'coding';
    case 'system_design':
      return 'system-design';
    case 'behavioral':
    case 'auto':
      return 'behavioral';
  }
}
