import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
// Importing the plugin's types augments FastifyInstance with `.websocketServer` and
// enables the `{ websocket: true }` route option.
import '@fastify/websocket';
import type { WebSocket } from '@fastify/websocket';
import type { RawData } from 'ws';
import {
  AUDIO_BYTES_PER_FRAME,
  encodeServerMessage,
  decodeClientMessage,
  type ClientMessage,
} from '@repo/shared';
import { logger } from '../logger';
import { FrameStatsWindow } from './frame-stats';

/**
 * /ws/echo — Phase 1 diagnostic endpoint. Accepts raw PCM frames from the desktop app,
 * logs fps + RMS per second, and echoes a per-window `echo.stats` JSON message back so the
 * client can verify end-to-end wiring without depending on Deepgram / LLM.
 *
 * Not part of the real session protocol. Removed/replaced by /ws/session in Phase 3.
 */
export const echoRoutePlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // @ts-expect-error — @fastify/websocket@11.2.0 augments Fastify's RouteShorthandOptions
  // with a 1-generic signature, but Fastify 5 ships 8 generics, so declaration merging
  // fails and TS does not see `websocket: true` / `wsHandler`. Runtime is fine. Tracked:
  // https://github.com/fastify/fastify-websocket/issues — remove when upstream fixes it.
  app.get('/ws/echo', { websocket: true }, handleEchoConnection);
};

function handleEchoConnection(socket: WebSocket, req: FastifyRequest): void {
  const log = logger.child({ route: '/ws/echo', ip: req.ip });
  const stats = new FrameStatsWindow(1000);

  const ticker = setInterval(() => {
    const snap = stats.snapshot();
    log.debug(
      { framesReceived: snap.framesReceived, fps: snap.framesPerSecond, rmsDb: snap.rmsDb },
      'echo.stats',
    );
    safeSend(socket, encodeServerMessage({ type: 'echo.stats', ...snap }));
    stats.rollover();
  }, 1000);

  socket.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      const frame = toUint8Array(data);
      const result = stats.ingest(frame);
      if (!result.accepted) {
        log.warn({ reason: result.reason, bytes: frame.byteLength }, 'rejected frame');
        safeSend(
          socket,
          encodeServerMessage({
            type: 'error',
            code: 'BAD_FRAME',
            message: result.reason ?? 'invalid frame',
          }),
        );
      }
      return;
    }

    const text = rawDataToString(data);
    let msg: ClientMessage;
    try {
      msg = decodeClientMessage(text);
    } catch (err) {
      log.warn({ err: String(err), preview: text.slice(0, 100) }, 'invalid client message');
      safeSend(
        socket,
        encodeServerMessage({ type: 'error', code: 'BAD_FRAME', message: 'malformed message' }),
      );
      return;
    }
    if (msg.type === 'ping') {
      safeSend(socket, encodeServerMessage({ type: 'pong' }));
    }
  });

  socket.on('close', (code: number, reason: Buffer) => {
    clearInterval(ticker);
    const finalSnap = stats.snapshot();
    log.info(
      { code, reason: reason.toString('utf8'), totalFrames: finalSnap.framesReceived },
      'echo session ended',
    );
  });

  socket.on('error', (err: Error) => {
    log.error({ err: err.message }, 'ws error');
  });

  log.info(
    { frameBytes: AUDIO_BYTES_PER_FRAME, expectedFps: stats.expectedFps },
    'echo session opened',
  );
}

function safeSend(socket: WebSocket, payload: string): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(payload);
  }
}

function toUint8Array(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
