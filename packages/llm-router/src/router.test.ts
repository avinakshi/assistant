import { describe, expect, it, vi } from 'vitest';
import { LlmRouter, collectAnswer } from './router';
import type { AnswerContext, LlmProvider, ProviderName, StreamOptions } from './provider';

class ScriptedProvider implements LlmProvider {
  readonly name: ProviderName = 'gemini';
  public calls: AnswerContext[] = [];
  constructor(private readonly scripts: string[][]) {}
  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(ctx: AnswerContext, _opts?: StreamOptions): AsyncGenerator<string, void, void> {
    this.calls.push(ctx);
    const script = this.scripts[this.calls.length - 1] ?? this.scripts[this.scripts.length - 1] ?? [];
    for (const chunk of script) yield chunk;
  }
}

describe('LlmRouter', () => {
  it('streams deltas from the configured provider', async () => {
    const provider = new ScriptedProvider([['At my ', 'last job ', 'I owned billing.']]);
    const router = new LlmRouter({ gemini: provider });
    const { deltas, provider: name } = await router.startStream({
      tier: 'free',
      context: { question: 'Tell me about yourself' },
    });
    const full = await collectAnswer(deltas);
    expect(name).toBe('gemini');
    expect(full).toBe('At my last job I owned billing.');
  });

  it('retries with amended prompt when a banned word slips through', async () => {
    const provider = new ScriptedProvider([
      // First attempt contains 'leverage' — filter catches, router retries.
      ['We ', 'leverage ', 'Redis for caching.'],
      // Retry attempt is clean.
      ['We ', 'use Redis ', 'for caching so the hot path stays fast.'],
    ]);
    const events: string[] = [];
    const router = new LlmRouter({
      gemini: provider,
      onEvent: (ev) => events.push(ev.kind),
    });
    const { deltas } = await router.startStream({
      tier: 'free',
      context: { question: 'How do you scale this?' },
    });
    const full = await collectAnswer(deltas);
    expect(full.toLowerCase()).not.toContain('leverage');
    expect(events).toContain('banned.hit');
    // Retry context should have carried a retryHint.
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.retryHint).toMatch(/leverage/);
  });

  it('gives up after MAX_RETRIES (2) and emits raw fallback', async () => {
    // Always hits 'synergy', even on the third call.
    const provider = new ScriptedProvider([
      ['synergy across teams'],
      ['synergy still here'],
      ['synergy always'],
      ['final fallback synergy survived'],
    ]);
    const events: string[] = [];
    const router = new LlmRouter({
      gemini: provider,
      onEvent: (ev) => events.push(ev.kind),
    });
    const { deltas } = await router.startStream({
      tier: 'free',
      context: { question: 'scale to 10M QPS' },
    });
    const full = await collectAnswer(deltas);
    expect(events.filter((e) => e === 'banned.hit')).toHaveLength(3);
    expect(events).toContain('banned.exhausted');
    // Fallback emits raw, so the final text may still contain 'synergy'.
    expect(full).toContain('synergy');
  });

  it('defaults to Gemini even if Claude is configured (budget safeguard)', async () => {
    const gemini = new ScriptedProvider([['from gemini']]);
    const claude = new ScriptedProvider([['from claude']]);
    (claude as unknown as { name: string }).name = 'claude';
    const router = new LlmRouter({ gemini, claude });
    const { provider } = await router.startStream({
      tier: 'pro',
      context: { question: 'anything' },
    });
    expect(provider).toBe('gemini');
    expect(claude.calls).toHaveLength(0);
  });

  it('routes to Claude only when explicitly requested and configured', async () => {
    const gemini = new ScriptedProvider([['from gemini']]);
    const claude = new ScriptedProvider([['from claude']]);
    (claude as unknown as { name: string }).name = 'claude';
    const router = new LlmRouter({ gemini, claude });
    const { provider, deltas } = await router.startStream({
      tier: 'pro',
      llm: 'claude',
      context: { question: 'anything' },
    });
    const full = await collectAnswer(deltas);
    expect(provider).toBe('claude');
    expect(full).toBe('from claude');
    expect(gemini.calls).toHaveLength(0);
  });

  it('falls back to Gemini when Claude requested but not configured', async () => {
    const gemini = new ScriptedProvider([['from gemini']]);
    const events: string[] = [];
    const router = new LlmRouter({ gemini, onEvent: (ev) => events.push(ev.kind) });
    const { provider } = await router.startStream({
      tier: 'pro',
      llm: 'claude',
      context: { question: 'anything' },
    });
    expect(provider).toBe('gemini');
    expect(events).toContain('fallback.claude_unavailable');
  });
});
