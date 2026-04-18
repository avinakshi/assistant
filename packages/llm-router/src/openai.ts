/**
 * OpenAI GPT-5 / GPT-4.1 provider — deferred to Phase 4b.
 *
 * Will race against Claude in Pro Auto mode; OpenAI's automatic prompt caching on long
 * prompts gives us a comparable cost profile. GPT-4.1 is the Starter-tier option.
 */
import type { AnswerContext, LlmProvider, ProviderName, StreamOptions } from './provider';

export interface OpenAIConfig {
  apiKey: string;
  model?: 'gpt-5' | 'gpt-4.1';
}

export class OpenAIProvider implements LlmProvider {
  readonly name: ProviderName;
  constructor(private readonly config: OpenAIConfig) {
    this.name = (config.model ?? 'gpt-5') as ProviderName;
  }
  // eslint-disable-next-line require-yield
  async *stream(_ctx: AnswerContext, _opts?: StreamOptions): AsyncGenerator<string, void, void> {
    if (!this.config.apiKey) {
      throw new Error('OpenAIProvider not configured — OPENAI_API_KEY missing');
    }
    throw new Error('OpenAIProvider not yet implemented — scheduled for Phase 4b');
  }
}
