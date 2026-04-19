import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

process.env.WS_SHARED_SECRET ??= 'test-secret-0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
// Deepgram key needed so the /ws/session route registers too; not exercised here.
process.env.DEEPGRAM_API_KEY ??= 'mock-key';

const { buildServer } = await import('../src/server');

/**
 * Auth-gate + fallback tests for /api/prefs. Success path (real JWT → Supabase lookup)
 * needs a live Supabase project and is covered by manual end-to-end runs from the
 * desktop.
 */
describe('GET /api/prefs — auth gate', () => {
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

  it('rejects with 401 when no token is sent', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/prefs`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { persistTranscriptsDefault: boolean };
    // Even on 401 we still include a safe default so a buggy client can fall back.
    expect(body.persistTranscriptsDefault).toBe(true);
  });

  it('rejects with 401 when the token is a non-JWT (e.g. shared-secret)', async () => {
    const shared = process.env.WS_SHARED_SECRET!;
    const res = await fetch(`http://127.0.0.1:${port}/api/prefs?token=${shared}`);
    expect(res.status).toBe(401);
  });

  it('rejects with 401 when the token is gibberish', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/prefs?token=not-a-jwt`);
    expect(res.status).toBe(401);
  });

  it('accepts Bearer header form when token is present (still 401 without real JWT here)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/prefs`, {
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.status).toBe(401);
  });
});
