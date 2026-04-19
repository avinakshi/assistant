/**
 * POST /api/jd-resume-gap — Phase 13e. Given a (resumeId, jdId) pair, returns a JSON
 * gap analysis. JWT-only. Cached in `jd_resume_gaps` keyed by (user_id, resume_id, jd_id)
 * with a sha256 of (resume.updated_at, jd.updated_at) as the freshness tag — editing
 * either side re-runs Gemini, otherwise returns instantly.
 *
 * Rate limited at 30/min/user: high enough that a user scanning multiple JDs isn't
 * blocked; low enough that a runaway client can't burn Gemini credits.
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  buildJdResumeGapPrompt,
  parseJdResumeGapResponse,
  type JdResumeGap,
} from '@repo/prompts';
import { authenticateWsToken } from '../ws/auth';
import { getSupabaseAdmin } from '../lib/supabase';
import { renderStructuredResume } from '../lib/resume-render';
import { config } from '../config';
import { logger } from '../logger';
import { PerUserRateLimiter } from '../lib/rate-limiter';

const gapLimiter = new PerUserRateLimiter(30, 60_000);

const BodySchema = z.object({
  resumeId: z.string().uuid(),
  jdId: z.string().uuid(),
  /** Force a fresh Gemini call even if the cache is warm. Useful from the structured editor. */
  refresh: z.boolean().optional(),
});

export interface JdResumeGapResponse {
  readonly cached: boolean;
  readonly createdAt: string;
  readonly analysis: JdResumeGap;
}

export const jdResumeGapRoutePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/api/jd-resume-gap', async (req, reply) => {
    const authHeader = req.headers.authorization ?? '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const auth = await authenticateWsToken(bearer || null);
    if (auth.kind !== 'user') {
      return reply.code(401).send({ error: 'jwt required' });
    }

    const gate = gapLimiter.tryConsume(auth.userId);
    if (!gate.allowed) {
      reply.header('retry-after', String(Math.ceil(gate.retryAfterMs / 1_000)));
      return reply.code(429).send({ error: 'rate limited' });
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    }
    const { resumeId, jdId, refresh } = parsed.data;

    if (!config.GOOGLE_API_KEY) {
      return reply.code(503).send({ error: 'gemini not configured on this api' });
    }
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return reply.code(503).send({ error: 'supabase not configured on this api' });
    }

    // Load resume + JD, scoped to the calling user. We use explicit user_id filters
    // rather than relying on RLS so the failure mode is a clean 404 not a cryptic empty row.
    const [resumeRes, jdRes] = await Promise.all([
      supabase
        .from('resumes')
        .select('id, parsed_text, structured_json, updated_at')
        .eq('id', resumeId)
        .eq('user_id', auth.userId)
        .maybeSingle(),
      supabase
        .from('job_descriptions')
        .select('id, title, body, updated_at')
        .eq('id', jdId)
        .eq('user_id', auth.userId)
        .maybeSingle(),
    ]);
    if (resumeRes.error || jdRes.error) {
      logger.warn(
        { resumeErr: resumeRes.error?.message, jdErr: jdRes.error?.message },
        'gap: lookup failed',
      );
      return reply.code(500).send({ error: 'db error' });
    }
    const resumeRow = resumeRes.data as
      | { parsed_text?: string | null; structured_json?: unknown; updated_at?: string }
      | null;
    const jdRow = jdRes.data as
      | { title?: string; body?: string | null; updated_at?: string }
      | null;
    if (!resumeRow || !jdRow) {
      return reply.code(404).send({ error: 'resume or jd not found' });
    }

    const sourceHash = crypto
      .createHash('sha256')
      .update(`${resumeRow.updated_at ?? ''}|${jdRow.updated_at ?? ''}`)
      .digest('hex');

    // Cache lookup — by composite key, with hash check for freshness.
    if (!refresh) {
      const { data: cached } = await supabase
        .from('jd_resume_gaps')
        .select('analysis, source_hash, created_at')
        .eq('user_id', auth.userId)
        .eq('resume_id', resumeId)
        .eq('jd_id', jdId)
        .maybeSingle();
      const row = cached as
        | { analysis: unknown; source_hash: string; created_at: string }
        | null;
      if (row && row.source_hash === sourceHash) {
        const analysis = row.analysis as JdResumeGap;
        return reply.send({
          cached: true,
          createdAt: row.created_at,
          analysis,
        } satisfies JdResumeGapResponse);
      }
    }

    // Cache miss (or stale, or forced refresh). Call Gemini.
    const resumeText =
      renderStructuredResume(resumeRow.structured_json) ??
      (resumeRow.parsed_text ?? '').trim();
    const jdText = (jdRow.body ?? '').trim();
    if (!resumeText && !jdText) {
      return reply.code(400).send({ error: 'resume and jd are both empty' });
    }

    const prompt = buildJdResumeGapPrompt({
      resumeText,
      jdText,
      ...(jdRow.title ? { role: jdRow.title } : {}),
    });

    const client = new GoogleGenerativeAI(config.GOOGLE_API_KEY);
    const model = client.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    });

    const start = Date.now();
    let raw: string;
    try {
      const result = await model.generateContent(prompt);
      raw = result.response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message, resumeId, jdId }, 'gap: gemini failed');
      return reply.code(502).send({ error: 'gemini error' });
    }

    const analysis = parseJdResumeGapResponse(raw);
    if (!analysis) {
      logger.warn({ rawHead: raw.slice(0, 200), resumeId, jdId }, 'gap: bad JSON');
      return reply.code(502).send({ error: 'gemini returned bad JSON' });
    }

    // Upsert on the unique (user_id, resume_id, jd_id) key.
    const { error: upsertErr } = await supabase.from('jd_resume_gaps').upsert(
      {
        user_id: auth.userId,
        resume_id: resumeId,
        jd_id: jdId,
        source_hash: sourceHash,
        analysis,
      },
      { onConflict: 'user_id,resume_id,jd_id' },
    );
    if (upsertErr) {
      logger.warn({ err: upsertErr.message }, 'gap: upsert failed (non-fatal)');
    }

    logger.info(
      { userId: auth.userId, resumeId, jdId, elapsedMs: Date.now() - start },
      'gap: analysis generated',
    );
    return reply.send({
      cached: false,
      createdAt: new Date().toISOString(),
      analysis,
    } satisfies JdResumeGapResponse);
  });
};
