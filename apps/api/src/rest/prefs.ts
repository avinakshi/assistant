/**
 * GET /api/prefs — user preferences for the desktop app.
 *
 * The desktop calls this before every `session.start` to honor the user's
 * `persist_transcripts_default` toggle (set from /app/settings). JWT-only auth — this
 * endpoint is meaningless for shared-secret callers (there's no "user" to look up).
 *
 * Response shape:
 *   { persistTranscriptsDefault: boolean }
 *
 * On any error path (missing token, bad JWT, DB failure) we return a 401/500 AND
 * include a `persistTranscriptsDefault: true` fallback in the body so the caller can
 * still make a safe default decision without a second round-trip. The desktop trusts
 * only the 200 case; the body on error paths is informational.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticateWsToken } from '../ws/auth';
import { getSupabaseAdmin } from '../lib/supabase';
import { logger } from '../logger';

export const prefsRoutePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/api/prefs', async (req, reply) => {
    // Support both `?token=<jwt>` (matches the WS convention) and `Authorization: Bearer`
    // so future clients can pick whichever is cleaner for them.
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const authHeader = req.headers.authorization ?? '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const token = url.searchParams.get('token') ?? bearer;

    const auth = await authenticateWsToken(token || null);
    if (auth.kind !== 'user') {
      return reply.code(401).send({
        error: 'jwt required',
        persistTranscriptsDefault: true,
      });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      // Supabase not configured on this api — there's no profile to read. Return the
      // conservative default so the desktop keeps working.
      return reply.send({ persistTranscriptsDefault: true });
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('persist_transcripts_default')
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (error) {
      logger.warn(
        { userId: auth.userId, err: error.message },
        'prefs: profile read failed',
      );
      return reply.code(500).send({
        error: 'profile read failed',
        persistTranscriptsDefault: true,
      });
    }

    const raw = (data as { persist_transcripts_default?: unknown } | null)
      ?.persist_transcripts_default;
    const persistTranscriptsDefault = typeof raw === 'boolean' ? raw : true;
    return reply.send({ persistTranscriptsDefault });
  });
};
