/**
 * AssemblyAI Universal-Streaming fallback — stub wire-through.
 *
 * Full implementation lands when the user provisions an ASSEMBLYAI_API_KEY. The router
 * already knows how to fall back to us, so this file intentionally fails loudly at connect
 * time if called without an API key, and with a clear NotImplemented if called with one —
 * so we get a meaningful error instead of a silent fallback to broken code.
 */
import {
  type SttConnectOptions,
  type SttProvider,
  type SttSession,
} from './provider';

export interface AssemblyAIConfig {
  apiKey: string;
}

export class AssemblyAIProvider implements SttProvider {
  readonly name = 'assemblyai';
  constructor(private readonly config: AssemblyAIConfig) {}

  async connect(_opts: SttConnectOptions): Promise<SttSession> {
    if (!this.config.apiKey) {
      throw new Error(
        'AssemblyAI selected as fallback but ASSEMBLYAI_API_KEY is unset. ' +
          'Either set the key or keep Deepgram as the only provider.',
      );
    }
    throw new Error(
      'AssemblyAI provider not yet implemented — planned for the Phase 3 fallback path. ' +
        'Failover from Deepgram will currently surface as UPSTREAM_STT to the client.',
    );
  }
}
