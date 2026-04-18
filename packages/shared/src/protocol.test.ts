import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  ServerMessageSchema,
  decodeClientMessage,
  decodeServerMessage,
  encodeServerMessage,
} from './protocol';

describe('ClientMessage', () => {
  it('accepts a minimal session.start', () => {
    const msg = ClientMessageSchema.parse({ type: 'session.start' });
    expect(msg).toMatchObject({ type: 'session.start', mode: 'auto', llm: 'auto', language: 'en' });
  });

  it('rejects unknown message types', () => {
    expect(() => ClientMessageSchema.parse({ type: 'not-a-real-type' })).toThrow();
  });

  it('rejects oversized hint text', () => {
    const text = 'x'.repeat(2001);
    expect(() => ClientMessageSchema.parse({ type: 'hint', text })).toThrow();
  });

  it('validates uuid on feedback', () => {
    expect(() =>
      ClientMessageSchema.parse({ type: 'feedback', answerId: 'not-a-uuid', rating: 'good' }),
    ).toThrow();
  });
});

describe('ServerMessage', () => {
  it('round-trips echo.stats through encode/decode', () => {
    const original = {
      type: 'echo.stats' as const,
      framesReceived: 100,
      framesPerSecond: 50,
      rmsDb: -12.3,
      windowMs: 1000,
    };
    const encoded = encodeServerMessage(original);
    const decoded = decodeServerMessage(encoded);
    expect(decoded).toEqual(original);
  });

  it('rejects negative counts', () => {
    expect(() =>
      ServerMessageSchema.parse({
        type: 'echo.stats',
        framesReceived: -1,
        framesPerSecond: 0,
        rmsDb: -40,
        windowMs: 1000,
      }),
    ).toThrow();
  });

  it('validates error code enum', () => {
    const ok = ServerMessageSchema.parse({ type: 'error', code: 'AUTH', message: 'bad token' });
    expect(ok).toEqual({ type: 'error', code: 'AUTH', message: 'bad token' });
    expect(() =>
      ServerMessageSchema.parse({ type: 'error', code: 'MADE_UP', message: 'x' }),
    ).toThrow();
  });
});

describe('decodeClientMessage', () => {
  it('throws on malformed JSON', () => {
    expect(() => decodeClientMessage('{not json')).toThrow();
  });

  it('throws on schema-invalid JSON', () => {
    expect(() => decodeClientMessage('{"type":"bogus"}')).toThrow();
  });

  it('returns a typed message for valid JSON', () => {
    const msg = decodeClientMessage('{"type":"ping"}');
    expect(msg.type).toBe('ping');
  });
});
