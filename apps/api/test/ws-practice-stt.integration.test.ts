import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';

process.env.WS_SHARED_SECRET ??= 'test-secret-0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
// Deepgram key must be set for the route to register at all, but the route rejects
// unauthorized tokens BEFORE it ever tries to open Deepgram, so the value doesn't
// need to be real for these tests.
process.env.DEEPGRAM_API_KEY ??= 'mock-key';

const { buildServer } = await import('../src/server');

/**
 * These tests verify the auth gate on /ws/practice-stt without standing up a mock
 * Deepgram. We exercise the rejection paths only — success path needs an STT server
 * mock and is covered by the other integration tests for the session flow.
 */
describe('/ws/practice-stt integration — auth gate', () => {
  let app: FastifyInstance;
  let port: number;

  beforeEach(async () => {
    app = await buildServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('rejects a connection with no token (1008 auth)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/practice-stt`);
    const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
      ws.on('error', () => {
        /* errors also land on close for ws@8 */
      });
    });
    expect(closeEvent.code).toBe(1008);
  });

  it('rejects a bogus shared-secret-like token that is not a JWT', async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/practice-stt?token=${encodeURIComponent('not-a-real-jwt')}`,
    );
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.on('close', (code) => resolve({ code }));
      ws.on('error', () => {
        /* ignore */
      });
    });
    expect(closeEvent.code).toBe(1008);
  });

  it('rejects the plain shared-secret — this route does not accept it', async () => {
    // Shared-secret mode is only for /ws/session (live interview + CI). /ws/practice-stt
    // must have a real user, so passing WS_SHARED_SECRET should still get 1008.
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/practice-stt?token=${encodeURIComponent(process.env.WS_SHARED_SECRET!)}`,
    );
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.on('close', (code) => resolve({ code }));
      ws.on('error', () => {
        /* ignore */
      });
    });
    expect(closeEvent.code).toBe(1008);
  });
});
