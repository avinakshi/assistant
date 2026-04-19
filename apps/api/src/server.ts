import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { config } from './config';
import { echoRoutePlugin } from './ws/echo-handler';
import { sessionRoutePlugin } from './ws/session-handler';
import { practiceSttRoutePlugin } from './ws/practice-stt-handler';
import { prefsRoutePlugin } from './rest/prefs';
import { extensionCodingAnswerPlugin } from './rest/extension-coding-answer';
import { apiKeysRoutePlugin } from './rest/api-keys';
import { sessionChatRoutePlugin } from './rest/session-chat';
import { jdResumeGapRoutePlugin } from './rest/jd-resume-gap';

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

  // Small HTTP surfaces.
  await app.register(prefsRoutePlugin);
  await app.register(apiKeysRoutePlugin);
  // Chrome extension's coding-answer endpoint. Needs Gemini configured to actually
  // answer; endpoint is registered either way so calls fail with a meaningful 503.
  await app.register(extensionCodingAnswerPlugin);
  // "Ask AI about this session" post-interview chat. Registered unconditionally;
  // returns 503 when Gemini or Supabase is unconfigured.
  await app.register(sessionChatRoutePlugin);
  // JD ↔ resume gap analysis (Phase 13e). Cached per (resume_id, jd_id) pair.
  await app.register(jdResumeGapRoutePlugin);

  await app.register(echoRoutePlugin);

  // /ws/session requires a Deepgram key — only register the route if one is configured,
  // so local dev without an STT key still starts cleanly for /ws/echo + /health work.
  if (config.DEEPGRAM_API_KEY) {
    await app.register(sessionRoutePlugin);
    // Phase 8b — practice-mode voice STT. Same key requirement.
    await app.register(practiceSttRoutePlugin);
  }

  return app;
}

export { config };
