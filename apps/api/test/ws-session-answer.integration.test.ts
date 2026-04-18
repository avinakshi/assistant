import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import type { WebSocket as FastifyWs } from '@fastify/websocket';
import { decodeServerMessage, encodeServerMessage } from '@repo/shared';
import {
  LlmRouter,
  type AnswerContext,
  type LlmProvider,
  type ProviderName,
  type StreamOptions,
} from '@repo/llm-router';
import { startMockDeepgram, type MockDeepgram } from './mock-deepgram-server';
import { DeepgramProvider } from '../src/providers/stt/deepgram';
import { AssemblyAIProvider } from '../src/providers/stt/assemblyai';
import { SttRouter } from '../src/providers/stt/router';
import { SessionOrchestrator } from '../src/ws/session-orchestrator';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const TEST_TOKEN = 'integration-test-shared-secret';

/**
 * Scriptable LLM provider — emits the configured chunks with a delay, or hangs until the
 * AbortSignal fires. Lets us verify the orchestrator's cancel-on-newer-question flow.
 */
class ScriptedLlm implements LlmProvider {
  readonly name: ProviderName = 'gemini';
  readonly calls: { ctx: AnswerContext; aborted: boolean }[] = [];

  constructor(
    private readonly chunks: string[],
    private readonly delayMs = 15,
  ) {}

  async *stream(ctx: AnswerContext, opts?: StreamOptions): AsyncGenerator<string, void, void> {
    const record = { ctx, aborted: false };
    this.calls.push(record);
    for (const chunk of this.chunks) {
      if (opts?.signal?.aborted) {
        record.aborted = true;
        return;
      }
      await sleep(this.delayMs);
      if (opts?.signal?.aborted) {
        record.aborted = true;
        return;
      }
      yield chunk;
    }
  }
}

describe('/ws/session integration — LLM answer flow', () => {
  let app: FastifyInstance;
  let port: number;
  let mock: MockDeepgram;
  let llm: ScriptedLlm;

  beforeEach(async () => {
    // Deepgram mock: one partial then a final "Tell me about yourself" (question).
    mock = await startMockDeepgram([
      {
        delayMs: 30,
        payload: {
          type: 'Results',
          is_final: false,
          channel: { alternatives: [{ transcript: 'Tell me about' }] },
        },
      },
      {
        delayMs: 80,
        payload: {
          type: 'Results',
          is_final: true,
          channel: { alternatives: [{ transcript: 'Tell me about yourself' }] },
        },
      },
    ]);

    llm = new ScriptedLlm(
      ['At my last ', 'job I owned ', 'billing and shipped it to ', 'ten thousand users.'],
      20,
    );
    const llmRouter = new LlmRouter({ gemini: llm });

    app = Fastify({ logger: false });
    await app.register(websocketPlugin, { options: { maxPayload: 64 * 1024 } });

    const primary = new DeepgramProvider({ apiKey: 'mock', baseUrl: mock.url });
    const fallback = new AssemblyAIProvider({ apiKey: '' });
    const sttRouter = new SttRouter({ primary, fallback });

    const handler = (socket: FastifyWs, req: FastifyRequest): void => {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (url.searchParams.get('token') !== TEST_TOKEN) {
        socket.send(encodeServerMessage({ type: 'error', code: 'AUTH', message: 'bad token' }));
        socket.close(1008, 'auth');
        return;
      }
      new SessionOrchestrator(socket, { router: sttRouter, llmRouter, logger: app.log });
    };
    // @ts-expect-error — @fastify/websocket augmentation bug vs Fastify 5 generics.
    app.get('/ws/session', { websocket: true }, handler);

    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await app.close();
    await mock.close();
  });

  it('fires an answer stream when a final transcript is a question', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session?token=${TEST_TOKEN}`);
    await waitForOpen(ws);

    const received: { type: string; [k: string]: unknown }[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('no answer.done within 3 s')), 3000);
      ws.on('message', (buf) => {
        const msg = decodeServerMessage(buf.toString('utf8'));
        received.push(msg as { type: string });
        if (msg.type === 'answer.done') {
          clearTimeout(to);
          resolve();
        }
      });
    });

    ws.send(
      JSON.stringify({ type: 'session.start', mode: 'auto', llm: 'auto', language: 'en' }),
    );
    await done;

    const kinds = received.map((m) => m.type);
    expect(kinds).toContain('session.ready');
    expect(kinds).toContain('transcript.final');
    expect(kinds).toContain('answer.start');
    expect(kinds.filter((k) => k === 'answer.delta').length).toBeGreaterThan(0);
    expect(kinds).toContain('answer.done');

    const deltas = received
      .filter((m): m is { type: 'answer.delta'; text: string } => m.type === 'answer.delta')
      .map((m) => m.text)
      .join('');
    expect(deltas).toBe('At my last job I owned billing and shipped it to ten thousand users.');

    ws.close();
  });
});

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
