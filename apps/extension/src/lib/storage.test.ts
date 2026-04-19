import { describe, it, expect } from 'vitest';
import { parseSessionBundle } from './storage';

describe('parseSessionBundle', () => {
  const valid = {
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: 1234567890,
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'anon',
  };

  it('parses a well-formed bundle', () => {
    expect(parseSessionBundle(JSON.stringify(valid))).toEqual(valid);
  });

  it('passes through apiBaseUrl when present', () => {
    const withApi = { ...valid, apiBaseUrl: 'http://localhost:3001' };
    expect(parseSessionBundle(JSON.stringify(withApi))).toEqual(withApi);
  });

  it('returns null when a required field is missing', () => {
    const { accessToken: _omit, ...missingAccess } = valid;
    expect(parseSessionBundle(JSON.stringify(missingAccess))).toBeNull();
  });

  it('returns null when the JSON is malformed', () => {
    expect(parseSessionBundle('not json')).toBeNull();
  });

  it('returns null for a non-object top level', () => {
    expect(parseSessionBundle('[1,2,3]')).toBeNull();
    expect(parseSessionBundle('null')).toBeNull();
    expect(parseSessionBundle('"string"')).toBeNull();
  });

  it('tolerates extra unknown keys', () => {
    const extra = { ...valid, somethingElse: 42 };
    const out = parseSessionBundle(JSON.stringify(extra));
    expect(out).toEqual(valid);
  });
});
