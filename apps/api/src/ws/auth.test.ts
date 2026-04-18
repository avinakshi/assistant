import { describe, it, expect, vi } from 'vitest';

// config.ts parses process.env at import time and needs WS_SHARED_SECRET ≥16 chars.
process.env.WS_SHARED_SECRET ??= 'test-secret-0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { authenticateWsToken } = await import('./auth');
const { config } = await import('../config');

/**
 * The auth module consults the Supabase admin client for JWT verification. Tests inject
 * a fake via the `supabase` option so we don't need a real Supabase instance, nor do we
 * need to mock the module graph.
 */
type FakeClient = { auth: { getUser: ReturnType<typeof vi.fn> } };

function userOk(id: string, email?: string): FakeClient {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id, ...(email ? { email } : {}) } },
        error: null,
      }),
    },
  };
}

function userErr(): FakeClient {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: 'invalid jwt' },
      }),
    },
  };
}

// Minimum: 3 base64url chunks of ≥7 chars each so it passes the sniff.
const JWT_LIKE =
  'eyJhbGciOi.eyJzdWIiOi' + '-0123456789abcdef.signaturePortion_abcdef';

describe('authenticateWsToken', () => {
  it('denies when token is missing', async () => {
    const r = await authenticateWsToken(null);
    expect(r).toEqual({ kind: 'denied', reason: 'missing-token' });
  });

  it('accepts the configured shared-secret', async () => {
    const r = await authenticateWsToken(config.WS_SHARED_SECRET);
    expect(r).toEqual({ kind: 'shared-secret' });
  });

  it('rejects a non-JWT that is not the shared-secret', async () => {
    const r = await authenticateWsToken('hunter2');
    expect(r).toEqual({ kind: 'denied', reason: 'bad-token' });
  });

  it('rejects a JWT-shaped token when no Supabase client is configured', async () => {
    // supabase: null explicitly disables verification.
    const r = await authenticateWsToken(JWT_LIKE, { supabase: null });
    expect(r).toEqual({ kind: 'denied', reason: 'jwt-invalid' });
  });

  it('returns { kind: "user" } for a valid JWT verified by Supabase', async () => {
    const fake = userOk('uuid-42', 'u@e.com');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await authenticateWsToken(JWT_LIKE, { supabase: fake as any });
    expect(r).toEqual({ kind: 'user', userId: 'uuid-42', email: 'u@e.com' });
    expect(fake.auth.getUser).toHaveBeenCalledWith(JWT_LIKE);
  });

  it('returns denied when Supabase says the JWT is invalid', async () => {
    const fake = userErr();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await authenticateWsToken(JWT_LIKE, { supabase: fake as any });
    expect(r).toEqual({ kind: 'denied', reason: 'jwt-invalid' });
  });
});
