import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { config } from './config';
import { echoRoutePlugin } from './ws/echo-handler';
import { sessionRoutePlugin } from './ws/session-handler';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    // Fastify owns the pino lifecycle. Our ./logger is used by non-request code
    // (pipelines, workers). Keeping them separate avoids version-skew type errors.
    logger: {
      level: config.LOG_LEVEL,
      base: { service: 'api' },
    },
    trustProxy: true,
    // REST body limit — 16 MB mirrors the WS maxPayload for parity when REST /api/ocr/*
    // lands (Phase 5 uses WS; Phase 6 may add REST for browsers without a WS session).
    bodyLimit: 16 * 1024 * 1024,
  });

  await app.register(websocketPlugin, {
    // 16 MB — screenshot PNGs are typically 200-800 KB, a 4K multi-monitor capture can hit
    // 4 MB. 16 MB gives headroom without inviting abuse.
    options: { maxPayload: 16 * 1024 * 1024 },
  });

  app.get('/health', async () => ({ ok: true, service: 'api', ts: Date.now() }));

  await app.register(echoRoutePlugin);

  // /ws/session requires a Deepgram key — only register the route if one is configured,
  // so local dev without an STT key still starts cleanly for /ws/echo + /health work.
  if (config.DEEPGRAM_API_KEY) {
    await app.register(sessionRoutePlugin);
  }

  return app;
}

export { config };
