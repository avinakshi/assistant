import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import type { WebSocket as FastifyWs } from '@fastify/websocket';
import { AUDIO_BYTES_PER_FRAME, decodeServerMessage, encodeServerMessage } from '@repo/shared';
import { startMockDeepgram, type MockDeepgram } from './mock-deepgram-server';
import { DeepgramProvider } from '../src/providers/stt/deepgram';
import { AssemblyAIProvider } from '../src/providers/stt/assemblyai';
import { SttRouter } from '../src/providers/stt/router';
import { SessionOrchestrator } from '../src/ws/session-orchestrator';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const TEST_TOKEN = 'integration-test-shared-secret';

describe('/ws/session integration (with mock Deepgram)', () => {
  let app: FastifyInstance;
  let port: number;
  let mock: MockDeepgram;

  beforeEach(async () => {
    mock = await startMockDeepgram([
      {
        delayMs: 50,
        payload: {
          type: 'Results',
          is_final: false,
          channel: { alternatives: [{ transcript: 'tell' }] },
        },
      },
      {
        delayMs: 100,
        payload: {
          type: 'Results',
          is_final: false,
          channel: { alternatives: [{ transcript: 'tell me about' }] },
        },
      },
      {
        delayMs: 200,
        payload: {
          type: 'Results',
          is_final: true,
          channel: { alternatives: [{ transcript: 'tell me about yourself' }] },
        },
      },
    ]);

    app = Fastify({ logger: false });
    await app.register(websocketPlugin, { options: { maxPayload: 64 * 1024 } });

    const primary = new DeepgramProvider({ apiKey: 'mock-key', baseUrl: mock.url });
    const fallback = new AssemblyAIProvider({ apiKey: '' });
    const router = new SttRouter({ primary, fallback });

    const handler = (socket: FastifyWs, req: FastifyRequest): void => {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (url.searchParams.get('token') !== TEST_TOKEN) {
        socket.send(encodeServerMessage({ type: 'error', code: 'AUTH', message: 'bad token' }));
        socket.close(1008, 'auth');
        return;
      }
      new SessionOrchestrator(socket, { router, logger: app.log });
    };

    // @ts-expect-error — @fastify/websocket augmentation bug vs Fastify 5 generics.
    app.get('/ws/session', { websocket: true }, handler);

    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mock) await mock.close();
  });

  it('completes the session.start → transcripts flow end-to-end', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session?token=${TEST_TOKEN}`);
    await waitForOpen(ws);

    const received: unknown[] = [];
    const ready = new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('no session.ready within 3s')), 3000);
      ws.on('message', (buf) => {
        const msg = decodeServerMessage(buf.toString('utf8'));
        received.push(msg);
        if (msg.type === 'session.ready') {
          clearTimeout(to);
          resolve();
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: 'session.start',
        mode: 'auto',
        llm: 'auto',
        language: 'en',
      }),
    );
    await ready;

    for (let i = 0; i < 5; i++) {
      ws.send(new Uint8Array(AUDIO_BYTES_PER_FRAME), { binary: true });
    }

    await new Promise((r) => setTimeout(r, 400));

    const partials = received.filter(
      (m): m is { type: 'transcript.partial'; text: string } =>
        (m as { type?: string }).type === 'transcript.partial',
    );
    const finals = received.filter(
      (m): m is { type: 'transcript.final'; text: string; isQuestion: boolean } =>
        (m as { type?: string }).type === 'transcript.final',
    );

    expect(partials.length).toBeGreaterThanOrEqual(1);
    expect(partials[0]!.text).toBe('tell');
    expect(finals.length).toBe(1);
    expect(finals[0]!.text).toBe('tell me about yourself');
    expect(finals[0]!.isQuestion).toBe(true);
    ws.close();
  });

  it('rejects connection with a bad token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session?token=wrong`);
    const result = await new Promise<{ closed: boolean; code?: number }>((resolve) => {
      ws.on('close', (code) => resolve({ closed: true, code }));
      ws.on('error', () => resolve({ closed: true }));
      setTimeout(() => resolve({ closed: false }), 2000);
    });
    expect(result.closed).toBe(true);
  });
});

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}
