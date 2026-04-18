import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import {
  AUDIO_BYTES_PER_FRAME,
  AUDIO_FRAMES_PER_SECOND,
  decodeServerMessage,
} from '@repo/shared';

// Ensure required env is set before importing the server, since config.ts parses at import time.
process.env.WS_SHARED_SECRET ??= 'test-secret-0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { buildServer } = await import('../src/server');

describe('POST /ws/echo integration', () => {
  let app: FastifyInstance;
  let port: number;

  beforeEach(async () => {
    app = await buildServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts 25 valid PCM frames and returns an echo.stats message', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/echo`);
    await waitForOpen(ws);

    const stats = new Promise<unknown>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('no stats received within 2 s')), 2500);
      ws.on('message', (buf) => {
        const msg = decodeServerMessage(buf.toString('utf8'));
        if (msg.type === 'echo.stats') {
          clearTimeout(to);
          resolve(msg);
        }
      });
    });

    // 25 frames = 500 ms of audio → first tick (at 1 s) should include them.
    for (let i = 0; i < 25; i++) {
      const frame = new Uint8Array(AUDIO_BYTES_PER_FRAME);
      ws.send(frame, { binary: true });
      await sleep(10);
    }

    const msg = (await stats) as { type: 'echo.stats'; framesReceived: number; framesPerSecond: number };
    expect(msg.type).toBe('echo.stats');
    expect(msg.framesReceived).toBe(25);
    // Expected fps = 25 frames over ~1000 ms ≈ 25 — allow jitter.
    expect(msg.framesPerSecond).toBeGreaterThan(5);
    expect(msg.framesPerSecond).toBeLessThan(AUDIO_FRAMES_PER_SECOND);
    ws.close();
  });

  it('rejects an invalid-sized binary frame with a BAD_FRAME error', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/echo`);
    await waitForOpen(ws);

    const errorPromise = new Promise<unknown>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('no error received')), 1500);
      ws.on('message', (buf) => {
        const msg = decodeServerMessage(buf.toString('utf8'));
        if (msg.type === 'error') {
          clearTimeout(to);
          resolve(msg);
        }
      });
    });

    ws.send(new Uint8Array(123), { binary: true });

    const msg = (await errorPromise) as { type: 'error'; code: string };
    expect(msg.code).toBe('BAD_FRAME');
    ws.close();
  });

  it('responds to ping with pong', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/echo`);
    await waitForOpen(ws);

    const pongPromise = new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('no pong')), 1500);
      ws.on('message', (buf) => {
        const msg = decodeServerMessage(buf.toString('utf8'));
        if (msg.type === 'pong') {
          clearTimeout(to);
          resolve();
        }
      });
    });

    ws.send(JSON.stringify({ type: 'ping' }));
    await pongPromise;
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
