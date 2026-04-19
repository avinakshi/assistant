/**
 * /api/keys — per-user CRUD for API keys.
 *
 *   POST   /api/keys       — create a new key, returns plaintext once
 *   GET    /api/keys       — list the user's non-revoked keys (metadata only)
 *   DELETE /api/keys/:id   — revoke (sets revoked_at); idempotent
 *
 * All routes are JWT-only; an API key can't manage keys (prevents lateral compromise).
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticateWsToken } from '../ws/auth';
import { getSupabaseAdmin } from '../lib/supabase';
import { generateApiKey } from '../lib/api-keys';
import { PerUserRateLimiter } from '../lib/rate-limiter';

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

// 5 new keys per user per hour. Prevents abuse; still plenty for real workflows
// (user creates one per device — laptop, phone, server — and is done).
const createKeyLimiter = new PerUserRateLimiter(5, 60 * 60 * 1_000);

export const apiKeysRoutePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Small shared auth helper scoped to this plugin — extracts the JWT + enforces the
  // stricter "must be jwt, not api key" rule.
  const requireJwt = async (req: FastifyRequest) => {
    const authHeader = (req.headers.authorization ?? '') as string;
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const queryToken = new URL(req.url, 'http://localhost').searchParams.get('token');
    const token = bearer || queryToken;
    const auth = await authenticateWsToken(token);
    if (auth.kind !== 'user' || auth.via !== 'jwt') {
      return { ok: false as const };
    }
    return { ok: true as const, userId: auth.userId };
  };

  app.post('/api/keys', async (req, reply) => {
    const auth = await requireJwt(req);
    if (!auth.ok) return reply.code(401).send({ error: 'jwt required' });

    const gate = createKeyLimiter.tryConsume(auth.userId);
    if (!gate.allowed) {
      const retrySec = Math.ceil(gate.retryAfterMs / 1_000);
      reply.header('retry-after', String(retrySec));
      return reply.code(429).send({ error: 'rate limited', retryAfterSeconds: retrySec });
    }

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid body',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const supabase = getSupabaseAdmin();
    if (!supabase) return reply.code(503).send({ error: 'supabase not configured' });

    const key = generateApiKey();
    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        user_id: auth.userId,
        name: parsed.data.name,
        prefix: key.visiblePrefix,
        hashed_secret: key.hashed,
      })
      .select('id, name, prefix, created_at')
      .single();
    if (error || !data) {
      return reply.code(500).send({ error: error?.message ?? 'insert failed' });
    }
    const row = data as { id: string; name: string; prefix: string; created_at: string };
    // Plaintext is surfaced exactly once. The client (settings page) shows it and tells
    // the user to copy; we never write it anywhere.
    return reply.send({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.created_at,
      plaintext: key.plaintext,
    });
  });

  app.get('/api/keys', async (req, reply) => {
    const auth = await requireJwt(req);
    if (!auth.ok) return reply.code(401).send({ error: 'jwt required' });
    const supabase = getSupabaseAdmin();
    if (!supabase) return reply.code(503).send({ error: 'supabase not configured' });

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, name, prefix, created_at, last_used_at, revoked_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });
    if (error) return reply.code(500).send({ error: error.message });
    return reply.send({ keys: data ?? [] });
  });

  app.delete('/api/keys/:id', async (req, reply) => {
    const auth = await requireJwt(req);
    if (!auth.ok) return reply.code(401).send({ error: 'jwt required' });
    const id = (req.params as { id?: string }).id;
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      return reply.code(400).send({ error: 'bad id' });
    }
    const supabase = getSupabaseAdmin();
    if (!supabase) return reply.code(503).send({ error: 'supabase not configured' });

    const { error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', auth.userId);
    if (error) return reply.code(500).send({ error: error.message });
    return reply.code(204).send();
  });
};
