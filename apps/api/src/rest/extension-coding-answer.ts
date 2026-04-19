/**
 * POST /api/extension/coding-answer — called by the Chrome extension when the user
 * clicks "Get solution" on a LeetCode problem. JWT-only (rejects shared-secret; this
 * is a per-user surface that should count against real quotas).
 *
 * Accepts the DOM-parsed problem shape from apps/extension/src/lib/leetcode-parser.ts
 * (duplicated here as a Zod schema so we validate at the HTTP boundary; extension
 * shouldn't need @repo/shared). The LLM is invoked through the router in non-streaming
 * form — for a single "give me the solution" request, a full JSON response is simpler
 * than an SSE stream, and extension popups are naturally patient for ~2s.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ClaudeProvider, GeminiProvider, LlmRouter } from '@repo/llm-router';
import { authenticateWsToken } from '../ws/auth';
import { config } from '../config';
import { logger } from '../logger';

const CodingProblemSchema = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(20_000).optional(),
  examples: z
    .array(
      z.object({
        input: z.string().max(2_000).optional(),
        output: z.string().max(2_000).optional(),
        explanation: z.string().max(4_000).optional(),
      }),
    )
    .max(10)
    .optional(),
  constraints: z.array(z.string().max(500)).max(30).optional(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
  rawText: z.string().max(30_000),
});

const BodySchema = z.object({
  problem: CodingProblemSchema,
  language: z.string().min(2).max(10).default('en'),
});

export const extensionCodingAnswerPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/api/extension/coding-answer', async (req, reply) => {
    // Auth: Bearer JWT or ?token query. Shared-secret is rejected explicitly.
    const authHeader = req.headers.authorization ?? '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const queryToken = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
      .searchParams.get('token');
    const token = bearer || queryToken;
    const auth = await authenticateWsToken(token);
    if (auth.kind !== 'user') {
      return reply.code(401).send({ error: 'jwt required' });
    }

    // Validate body.
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid body',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const { problem, language } = parsed.data;

    if (!config.GOOGLE_API_KEY) {
      return reply.code(503).send({ error: 'gemini not configured on this api' });
    }

    const gemini = new GeminiProvider({ apiKey: config.GOOGLE_API_KEY });
    const routerArgs: ConstructorParameters<typeof LlmRouter>[0] = {
      gemini,
      onEvent: (ev) => {
        if (ev.kind === 'banned.hit') {
          logger.warn({ offender: ev.offender, attempt: ev.attempt }, 'extension: banned word hit');
        }
      },
    };
    if (config.ANTHROPIC_API_KEY) {
      routerArgs.claude = new ClaudeProvider({
        apiKey: config.ANTHROPIC_API_KEY,
        model: config.CLAUDE_MODEL,
      });
    }
    const router = new LlmRouter(routerArgs);

    const start = Date.now();
    let firstTokenAt: number | null = null;
    let provider = 'unknown';

    try {
      const stream = await router.startStream({
        tier: 'free',
        llm: 'auto',
        context: {
          question: problem.title
            ? `Solve: ${problem.title}`
            : 'Solve this coding problem shown in the extension.',
          language,
          hint: 'coding',
          codingProblem: {
            site: 'leetcode',
            examples: (problem.examples ?? []).map((ex) => ({
              ...(ex.input !== undefined ? { input: ex.input } : {}),
              ...(ex.output !== undefined ? { output: ex.output } : {}),
              ...(ex.explanation !== undefined ? { explanation: ex.explanation } : {}),
            })),
            constraints: problem.constraints ?? [],
            rawText: problem.rawText,
            ...(problem.title ? { title: problem.title } : {}),
            ...(problem.description ? { description: problem.description } : {}),
            ...(problem.difficulty ? { difficulty: problem.difficulty } : {}),
          },
        },
      });
      provider = stream.provider;
      const parts: string[] = [];
      for await (const delta of stream.deltas) {
        if (firstTokenAt === null) firstTokenAt = Date.now();
        parts.push(delta);
      }
      const answer = parts.join('');
      const latencyMs = (firstTokenAt ?? Date.now()) - start;
      logger.info(
        {
          userId: auth.userId,
          provider,
          latencyMs,
          chars: answer.length,
          hasTitle: !!problem.title,
        },
        'extension: coding answer',
      );
      return reply.send({ answer, provider, latencyMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message, provider }, 'extension: llm error');
      return reply.code(502).send({ error: message, provider });
    }
  });
};
