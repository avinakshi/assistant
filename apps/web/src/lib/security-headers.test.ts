import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { applySecurityHeaders } from './security-headers';

describe('applySecurityHeaders', () => {
  it('returns the same response object (mutates in place)', () => {
    const res = NextResponse.next();
    const out = applySecurityHeaders(res);
    expect(out).toBe(res);
  });

  it('sets the baseline hardening headers', () => {
    const res = applySecurityHeaders(NextResponse.next());
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=\d+/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('permissions-policy denies camera/geolocation/payment', () => {
    const res = applySecurityHeaders(NextResponse.next());
    const pp = res.headers.get('permissions-policy') ?? '';
    expect(pp).toContain('camera=()');
    expect(pp).toContain('geolocation=()');
    expect(pp).toContain('payment=()');
  });

  it('permissions-policy allows microphone only for self', () => {
    // /app/practice voice mode uses the mic; we must not deny it wholesale.
    const res = applySecurityHeaders(NextResponse.next());
    const pp = res.headers.get('permissions-policy') ?? '';
    expect(pp).toContain('microphone=(self)');
    expect(pp).not.toContain('microphone=()');
  });

  it('HSTS includes subdomains', () => {
    const res = applySecurityHeaders(NextResponse.next());
    expect(res.headers.get('strict-transport-security')).toContain('includeSubDomains');
  });
});
