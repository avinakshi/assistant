import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey, looksLikeApiKey, API_KEY_PREFIX } from './api-keys';

describe('generateApiKey', () => {
  it('returns a key matching the sk-ic-<20-base32> shape', () => {
    const key = generateApiKey();
    expect(key.plaintext).toMatch(/^sk-ic-[a-z0-9]{20}$/);
    expect(key.visiblePrefix).toBe(key.plaintext.slice(0, 10));
    expect(key.visiblePrefix.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it('hashes the plaintext to a 64-char hex (SHA-256) — not the raw value', () => {
    const key = generateApiKey();
    expect(key.hashed).toMatch(/^[a-f0-9]{64}$/);
    expect(key.hashed).not.toContain(key.plaintext);
  });

  it('hashing is deterministic', () => {
    const plain = 'sk-ic-abcdefghijklmnopqrst';
    expect(hashApiKey(plain)).toBe(hashApiKey(plain));
  });

  it('different plaintexts hash differently', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hashed).not.toBe(b.hashed);
  });

  it('batch-generated keys are pairwise distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateApiKey().plaintext);
    expect(seen.size).toBe(100);
  });
});

describe('looksLikeApiKey', () => {
  it('accepts a valid-shaped key', () => {
    expect(looksLikeApiKey('sk-ic-abcdefghijklmnopqrst')).toBe(true);
  });

  it('rejects the wrong prefix', () => {
    expect(looksLikeApiKey('pk-ic-abcdefghijklmnopqrst')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(looksLikeApiKey('sk-ic-abcdefgh')).toBe(false);
    expect(looksLikeApiKey('sk-ic-abcdefghijklmnopqrstu')).toBe(false);
  });

  it('rejects uppercase (we store lowercase only)', () => {
    expect(looksLikeApiKey('sk-ic-ABCDEFGHIJKLMNOPQRST')).toBe(false);
  });

  it('rejects non-base32 characters', () => {
    expect(looksLikeApiKey('sk-ic-!@#$%^&*()abcdefghij')).toBe(false);
  });

  it('rejects raw JWTs', () => {
    expect(looksLikeApiKey('eyJhbGci.eyJzdWIi.sig')).toBe(false);
  });
});
