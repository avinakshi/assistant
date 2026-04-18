/**
 * Gemini 2.5 Flash streaming provider.
 *
 * Model choice: `gemini-2.5-flash` matches SPEC §5.5 for the Free tier and Phase 4a
 * "Gemini-only" bootstrap. Pro tier will race against Claude + GPT once Phase 4b ships.
 *
 * Auth: GOOGLE_API_KEY header via `@google/generative-ai` SDK.
 *
 * Caching: Gemini's caching API isn't enabled in the SDK default path; we send the full
 * prompt every call. It's cheap enough (sub-cent per answer at our volume) to defer.
 */
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
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

export interface GeminiConfig {
  apiKey: string;
  /** Override for tests. Defaults to 'gemini-2.5-flash'. */
  model?: string;
}

export class GeminiProvider implements LlmProvider {
  readonly name: ProviderName = 'gemini';
  private readonly client: GoogleGenerativeAI;
  private readonly model: GenerativeModel;

  constructor(config: GeminiConfig) {
    if (!config.apiKey) throw new Error('GeminiProvider: apiKey is required');
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = this.client.getGenerativeModel({
      // Default to flash-lite: Gemini 2.5 Flash has "thinking" tokens on by default which
      // burn ~2.5 s of TTFT + eat output budget before any visible text arrives. Flash-lite
      // has thinking off and hits ~700 ms TTFT with full-length answers, which is the only
      // way to stay under the plan's <900 ms p50 end-to-end target.
      // Override via config.model for A/B testing or for coding/system-design where the
      // extra reasoning may pay for itself.
      model: config.model ?? 'gemini-2.5-flash-lite',
    });
  }

  async *stream(ctx: AnswerContext, opts: StreamOptions = {}): AsyncGenerator<string, void, void> {
    const signal = opts.signal;
    if (signal?.aborted) throw new AnswerAbortedError('user_abort');

    const pack: PromptPackName = hintToPack(ctx.hint ?? 'auto');
    const systemInstruction = promptFor(pack);
    const userMessage = buildUserMessage(ctx, true);

    const result = await this.model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    });

    for await (const chunk of result.stream) {
      if (signal?.aborted) throw new AnswerAbortedError('user_abort');
      const text = chunk.text();
      if (text.length > 0) yield text;
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

