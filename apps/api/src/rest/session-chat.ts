/**
 * POST /api/sessions/:id/chat — "Ask AI about this session" (Phase 13c).
 *
 * Multi-turn coach chat grounded in a completed session's transcript. Unlike the live
 * orchestrator's answer flow, this is post-session — we're not pretending to BE the
 * candidate, we're helping them reflect on what happened. Uses Gemini directly with a
 * coach-voice system prompt; the llm-router is bypassed because its prompt packs are
 * designed for live interview-answer generation (STAR scaffolding, first-person voice).
 *
 * Auth: JWT-only (rejects shared-secret + API keys — chatting about someone's session
 * requires a real signed-in user so Supabase RLS can scope the read).
 * Streaming: NDJSON, matches /api/extension/coding-answer for client-side symmetry.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  buildSessionChatPrompt,
  type SessionChatEvent,
  type SessionChatMessage,
} from '@repo/prompts';
import { authenticateWsToken } from '../ws/auth';
import { getSupabaseAdmin } from '../lib/supabase';
import { config } from '../config';
import { logger } from '../logger';
import { PerUserRateLimiter } from '../lib/rate-limiter';

// 20 chat turns per user per rolling minute — generous enough for rapid iteration on
// rephrasing an answer, tight enough that a runaway client can't burn Gemini credits.
const sessionChatLimiter = new PerUserRateLimiter(20, 60_000);

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8_000),
});

const BodySchema = z.object({
  message: z.string().min(1).max(8_000),
  history: z.array(MessageSchema).max(40).optional(),
});

export const sessionChatRoutePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/api/sessions/:id/chat', async (req, reply) => {
    const params = req.params as { id?: string };
    const sessionId = (params.id ?? '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(sessionId)) {
      return reply.code(400).send({ error: 'invalid session id' });
    }

    const authHeader = req.headers.authorization ?? '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const auth = await authenticateWsToken(bearer || null);
    if (auth.kind !== 'user' || auth.via !== 'jwt') {
      return reply.code(401).send({ error: 'jwt required' });
    }

    const gate = sessionChatLimiter.tryConsume(auth.userId);
    if (!gate.allowed) {
      const retrySec = Math.ceil(gate.retryAfterMs / 1_000);
      reply.header('retry-after', String(retrySec));
      return reply.code(429).send({ error: 'rate limited', retryAfterSeconds: retrySec });
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid body',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const { message, history = [] } = parsed.data;

    if (!config.GOOGLE_API_KEY) {
      return reply.code(503).send({ error: 'gemini not configured on this api' });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return reply.code(503).send({ error: 'supabase not configured on this api' });
    }

    // Verify ownership + load session metadata. We use the admin client (bypasses RLS)
    // and explicitly scope by user_id — RLS would be correct but we already know the
    // userId and an explicit check makes the audit trail obvious.
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .select('id, user_id, kind, mode')
      .eq('id', sessionId)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (sessionErr) {
      logger.warn({ err: sessionErr.message, sessionId }, 'session-chat: session lookup failed');
      return reply.code(500).send({ error: 'db error' });
    }
    if (!session) {
      return reply.code(404).send({ error: 'session not found' });
    }

    const { data: eventsData, error: eventsErr } = await supabase
      .from('session_events')
      .select('kind, payload')
      .eq('session_id', sessionId)
      .order('ts', { ascending: true });
    if (eventsErr) {
      logger.warn(
        { err: eventsErr.message, sessionId },
        'session-chat: events lookup failed',
      );
      return reply.code(500).send({ error: 'db error' });
    }
    const events: SessionChatEvent[] = ((eventsData as { kind: string; payload: Record<string, unknown> }[] | null) ?? []).map(
      (r) => ({ kind: r.kind, payload: r.payload }),
    );

    // Recap — optional; makes replies more grounded when available.
    const { data: recapRow } = await supabase
      .from('session_summaries')
      .select('highlights, improvements')
      .eq('session_id', sessionId)
      .maybeSingle();
    const recap = recapRow
      ? {
          highlights: Array.isArray(recapRow['highlights']) ? (recapRow['highlights'] as string[]) : [],
          improvements: Array.isArray(recapRow['improvements']) ? (recapRow['improvements'] as string[]) : [],
        }
      : undefined;

    const built = buildSessionChatPrompt({
      events,
      history: history as SessionChatMessage[],
      userMessage: message,
      ...(recap ? { recap } : {}),
    });

    // Map our history → Gemini's role format. Gemini uses 'user' and 'model'.
    const contents = built.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const client = new GoogleGenerativeAI(config.GOOGLE_API_KEY);
    const model = client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: { role: 'system', parts: [{ text: built.systemPrompt }] },
      generationConfig: { temperature: 0.5, topP: 0.95, maxOutputTokens: 1_200 },
    });

    const start = Date.now();
    let firstTokenAt: number | null = null;
    let chars = 0;

    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    raw.setHeader('cache-control', 'no-cache');
    raw.setHeader('connection', 'keep-alive');
    raw.flushHeaders?.();
    const writeLine = (obj: Record<string, unknown>): void => {
      raw.write(JSON.stringify(obj) + '\n');
    };

    try {
      writeLine({ type: 'start', provider: 'gemini' });
      const result = await model.generateContentStream({ contents });
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (!text) continue;
        if (firstTokenAt === null) firstTokenAt = Date.now();
        chars += text.length;
        writeLine({ type: 'delta', text });
      }
      const latencyMs = (firstTokenAt ?? Date.now()) - start;
      writeLine({ type: 'done', latencyMs, chars });
      logger.info(
        { userId: auth.userId, sessionId, chars, latencyMs, historyLen: history.length },
        'session-chat: reply streamed',
      );
      raw.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message, sessionId }, 'session-chat: gemini error');
      try { writeLine({ type: 'error', message }); } catch { /* ignore */ }
      try { raw.end(); } catch { /* ignore */ }
    }
  });
};
