/**
 * /ws/session — the real session endpoint. Parallel to /ws/echo (Phase 1 diagnostic).
 *
 * Phase 3 auth: simple shared-secret token via `?token=<WS_SHARED_SECRET>`. Real JWT +
 * device-fingerprint binding lands Phase 6.
 *
 * Phase 4 adds LLM streaming: if GOOGLE_API_KEY is set, every classified question triggers
 * a Gemini answer stream. Claude + OpenAI slots land Phase 4b.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import '@fastify/websocket';
import type { WebSocket } from '@fastify/websocket';
import {
  ClaudeProvider,
  GeminiProvider,
  LlmRouter,
  type LlmRouter as LlmRouterType,
} from '@repo/llm-router';
import { GoogleVisionProvider, type OcrProvider } from '@repo/ocr';
import { config } from '../config';
import { logger } from '../logger';
import { InMemoryOcrCache } from '../lib/ocr-cache';
import { SlidingWindowLimiter } from '../lib/rate-limiter';
import { DeepgramProvider } from '../providers/stt/deepgram';
import { AssemblyAIProvider } from '../providers/stt/assemblyai';
import { SttRouter } from '../providers/stt/router';
import { SessionOrchestrator } from './session-orchestrator';
import { encodeServerMessage } from '@repo/shared';

export const sessionRoutePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const sttRouter = buildSttRouter();
  const llmRouter = buildLlmRouter();
  const ocrProvider = buildOcrProvider();
  // One shared OCR cache across all sessions — same PNG from multiple candidates hits once.
  const ocrCache = new InMemoryOcrCache();

  // @ts-expect-error — @fastify/websocket@11.2.0 + Fastify 5 type-merge bug, same as /ws/echo.
  app.get('/ws/session', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');
    if (token !== config.WS_SHARED_SECRET) {
      logger.warn({ ip: req.ip }, 'session auth failed');
      try {
        socket.send(encodeServerMessage({ type: 'error', code: 'AUTH', message: 'bad token' }));
      } catch {
        /* ignore */
      }
      socket.close(1008, 'auth');
      return;
    }
    const log = logger.child({ route: '/ws/session', ip: req.ip });
    log.info(
      { llm: llmRouter ? 'enabled' : 'disabled', ocr: ocrProvider ? 'enabled' : 'disabled' },
      'session opened',
    );
    const deps: ConstructorParameters<typeof SessionOrchestrator>[1] = {
      router: sttRouter,
      logger: log,
    };
    if (llmRouter) deps.llmRouter = llmRouter;
    if (ocrProvider) {
      deps.ocrProvider = ocrProvider;
      deps.ocrCache = ocrCache;
      // Per-connection rate limit — 10 screenshots / minute per the spec.
      deps.ocrRateLimiter = new SlidingWindowLimiter(10, 60_000);
    }
    new SessionOrchestrator(socket, deps);
  });
};

function buildSttRouter(): SttRouter {
  if (!config.DEEPGRAM_API_KEY) {
    throw new Error(
      'DEEPGRAM_API_KEY is required to start /ws/session. Set it in .env or disable the route.',
    );
  }
  const primary = new DeepgramProvider({ apiKey: config.DEEPGRAM_API_KEY });
  const fallback = new AssemblyAIProvider({ apiKey: config.ASSEMBLYAI_API_KEY ?? '' });
  return new SttRouter({ primary, fallback });
}

function buildLlmRouter(): LlmRouterType | null {
  if (!config.GOOGLE_API_KEY) {
    logger.warn({}, 'GOOGLE_API_KEY unset — session will relay transcripts but not generate answers');
    return null;
  }
  const gemini = new GeminiProvider({ apiKey: config.GOOGLE_API_KEY });
  const routerConfig: ConstructorParameters<typeof LlmRouter>[0] = {
    gemini,
    onEvent: (ev) => {
      if (ev.kind === 'banned.hit') {
        logger.warn({ offender: ev.offender, attempt: ev.attempt }, 'banned word hit');
      } else if (ev.kind === 'banned.exhausted') {
        logger.error({ offender: ev.offender }, 'banned word retries exhausted — review prompt');
      } else if (ev.kind === 'fallback.claude_unavailable') {
        logger.warn({}, 'claude requested but not configured — fell back to gemini');
      }
    },
  };
  if (config.ANTHROPIC_API_KEY) {
    routerConfig.claude = new ClaudeProvider({
      apiKey: config.ANTHROPIC_API_KEY,
      model: config.CLAUDE_MODEL,
    });
    logger.info({ model: config.CLAUDE_MODEL }, 'claude configured (opt-in only)');
  }
  return new LlmRouter(routerConfig);
}

function buildOcrProvider(): OcrProvider | null {
  if (!config.GOOGLE_CLOUD_VISION_KEY) {
    logger.info({}, 'GOOGLE_CLOUD_VISION_KEY unset — screenshot/OCR disabled for this api');
    return null;
  }
  return new GoogleVisionProvider({ apiKey: config.GOOGLE_CLOUD_VISION_KEY });
}
