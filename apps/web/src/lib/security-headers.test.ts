import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { applySecurityHeaders, buildCspReportOnly } from './security-headers';

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

  it('emits CSP in report-only (not enforce) mode', () => {
    const res = applySecurityHeaders(NextResponse.next());
    expect(res.headers.get('content-security-policy-report-only')).toBeTruthy();
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});

describe('buildCspReportOnly', () => {
  it('includes the key directives + report-uri', () => {
    const csp = buildCspReportOnly();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('allows Supabase auth + realtime in connect-src', () => {
    const csp = buildCspReportOnly();
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.supabase\.co/);
    expect(csp).toMatch(/connect-src[^;]*wss:\/\/\*\.supabase\.co/);
  });

  it('keeps form-action scoped to self + Supabase (auth redirects)', () => {
    const csp = buildCspReportOnly();
    expect(csp).toMatch(/form-action[^;]*'self'/);
    expect(csp).toMatch(/form-action[^;]*https:\/\/\*\.supabase\.co/);
  });

  it('temporarily allows unsafe-inline for Next runtime glue', () => {
    // This is a known debt item — nonce-based CSP comes in a follow-up. The test pins
    // the current compromise so nobody silently tightens it without the nonce work.
    const csp = buildCspReportOnly();
    expect(csp).toContain("'unsafe-inline'");
  });
});
