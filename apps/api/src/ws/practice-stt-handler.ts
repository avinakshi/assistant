/**
 * /ws/practice-stt — narrow STT-only route for the browser-based voice practice flow.
 *
 * Unlike /ws/session (live interview mode), this route has no LLM, no OCR, no session
 * DB writes. It's a straight pipe: browser → Deepgram → back to browser.
 *
 * The Next.js practice actions still drive the interviewer turn logic; this route just
 * turns the candidate's speech into text. That split keeps the api surface minimal and
 * lets us evolve the interviewer prompts independently of the audio stack.
 *
 * Auth: Supabase JWT via `?token=<jwt>` query param (same format as /ws/session). We
 * deliberately don't accept the shared-secret fallback here — this route is only meant
 * for authenticated users practicing through the web app.
 *
 * Protocol:
 *   - Binary frames from client: 16kHz 16-bit mono PCM, AUDIO_BYTES_PER_FRAME each.
 *   - Text frames from server: `{ type: 'partial', text, ts }` or
 *     `{ type: 'final', text, ts }` or
 *     `{ type: 'error', message }`.
 *   - Client may send `{ type: 'stop' }` to cleanly end the stream; server also
 *     handles socket close.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import '@fastify/websocket';
import type { WebSocket } from '@fastify/websocket';
import type { RawData } from 'ws';
import { AUDIO_BYTES_PER_FRAME, AUDIO_SAMPLE_RATE_HZ } from '@repo/shared';
import { config } from '../config';
import { logger } from '../logger';
import { DeepgramProvider } from '../providers/stt/deepgram';
import type { SttSession } from '../providers/stt/provider';
import { authenticateWsToken } from './auth';

export const practiceSttRoutePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  if (!config.DEEPGRAM_API_KEY) {
    logger.warn({}, '/ws/practice-stt not registered — DEEPGRAM_API_KEY unset');
    return;
  }
  const deepgram = new DeepgramProvider({ apiKey: config.DEEPGRAM_API_KEY });

  // @ts-expect-error — @fastify/websocket@11.2.0 + Fastify 5 type-merge bug (same as echo/session).
  app.get('/ws/practice-stt', { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      const token = url.searchParams.get('token');
      const auth = await authenticateWsToken(token);
      if (auth.kind !== 'user') {
        logger.warn(
          { ip: req.ip, reason: auth.kind === 'denied' ? auth.reason : auth.kind },
          'practice-stt auth failed',
        );
        try {
          socket.send(JSON.stringify({ type: 'error', message: 'auth required' }));
        } catch {
          /* ignore */
        }
        socket.close(1008, 'auth');
        return;
      }

      const log = logger.child({ route: '/ws/practice-stt', ip: req.ip, userId: auth.userId });
      log.info({}, 'practice-stt opened');

      let stt: SttSession | null = null;
      let closed = false;

      const safeSend = (msg: unknown): void => {
        if (socket.readyState !== socket.OPEN) return;
        try {
          socket.send(JSON.stringify(msg));
        } catch (err) {
          log.warn({ err: String(err) }, 'send failed');
        }
      };

      const tearDown = async (reason: string): Promise<void> => {
        if (closed) return;
        closed = true;
        if (stt) {
          try {
            await stt.close();
          } catch (err) {
            log.warn({ err: String(err) }, 'stt close failed');
          }
          stt = null;
        }
        if (socket.readyState === socket.OPEN) socket.close(1000, reason);
      };

      try {
        stt = await deepgram.connect({
          language: url.searchParams.get('language') ?? 'en',
          sampleRateHz: AUDIO_SAMPLE_RATE_HZ,
          onPartial: (text, ts) => safeSend({ type: 'partial', text, ts }),
          onFinal: (text, ts) => safeSend({ type: 'final', text, ts }),
          onError: (err) => {
            log.warn({ code: err.code, message: err.message }, 'stt error');
            safeSend({ type: 'error', message: err.message });
          },
          onClose: (reason) => {
            log.info({ reason }, 'stt closed');
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, 'failed to open deepgram');
        safeSend({ type: 'error', message: 'stt unavailable' });
        await tearDown('stt-open-fail');
        return;
      }

      safeSend({ type: 'ready' });

      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (closed || !stt) return;
        if (isBinary) {
          const frame = toBuffer(data);
          if (frame.byteLength !== AUDIO_BYTES_PER_FRAME) {
            // Don't spam the client for every malformed frame — it'd overwhelm a
            // mis-configured recorder. Log once per handful.
            return;
          }
          stt.pushFrame(frame);
          return;
        }
        // Text frame: only `stop` is meaningful; everything else we ignore.
        try {
          const parsed = JSON.parse(toBuffer(data).toString('utf8')) as { type?: string };
          if (parsed.type === 'stop') {
            void tearDown('client-stop');
          }
        } catch {
          /* ignore */
        }
      });

      socket.on('close', (code: number, reason: Buffer) => {
        log.info({ code, reason: reason.toString() }, 'socket closed');
        void tearDown('socket-close');
      });

      socket.on('error', (err: Error) => {
        log.warn({ err: String(err) }, 'socket error');
        void tearDown('socket-error');
      });
    });
};

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
