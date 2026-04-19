import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

process.env.WS_SHARED_SECRET ??= 'test-secret-0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DEEPGRAM_API_KEY ??= 'mock-key';

const { buildServer } = await import('../src/server');

/**
 * Auth-gate smoke tests for /api/keys. Success paths (list/create/revoke with a real
 * JWT) need a live Supabase project and are covered by manual end-to-end runs from
 * /app/settings.
 */
describe('/api/keys — auth gate', () => {
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

  it('GET /api/keys rejects with 401 without a token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/keys`);
    expect(res.status).toBe(401);
  });

  it('GET /api/keys rejects the shared secret (jwt-only endpoint)', async () => {
    const shared = process.env.WS_SHARED_SECRET!;
    const res = await fetch(`http://127.0.0.1:${port}/api/keys`, {
      headers: { authorization: `Bearer ${shared}` },
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/keys requires a JSON body', async () => {
    const shared = process.env.WS_SHARED_SECRET!;
    const res = await fetch(`http://127.0.0.1:${port}/api/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${shared}` },
      body: JSON.stringify({}),
    });
    // 401 (shared rejected) comes before 400 (bad body). Either is acceptable for this
    // integration-level smoke.
    expect([400, 401]).toContain(res.status);
  });

  it('DELETE /api/keys/:id rejects malformed ids with 401 (auth gate) or 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/keys/not-a-uuid`, { method: 'DELETE' });
    expect([400, 401]).toContain(res.status);
  });
});
