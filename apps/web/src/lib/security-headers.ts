import type { NextResponse } from 'next/server';

/**
 * Apply baseline security headers to every web response.
 *
 * - HSTS forces https once we're deployed (no-op on http://localhost).
 * - X-Content-Type-Options stops MIME sniffing.
 * - X-Frame-Options prevents iframing (clickjacking).
 * - Referrer-Policy keeps URL details off third parties.
 * - Permissions-Policy denies the common sensor APIs we don't use on the web.
 *   (Mic access is needed by /app/practice's voice mode — allow self.)
 * - Content-Security-Policy-Report-Only emits violation reports to /api/csp-report
 *   without enforcing anything. Once the reports stabilize for a week we move to
 *   enforcement by swapping the header name; the policy text stays the same.
 */
export function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'permissions-policy',
    [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=(self)',
      'payment=()',
      'usb=()',
    ].join(', '),
  );
  response.headers.set('content-security-policy-report-only', buildCspReportOnly());
  return response;
}

/**
 * Build the CSP value. Report-only for now — we ship it to see what breaks before
 * enforcing. Known things that need allowing:
 * - Next.js uses inline <style> and inline <script> chunks (no nonce yet)
 * - Supabase auth talks to <project>.supabase.co for OAuth redirects
 * - WebSocket to the api (ws://localhost:3001 in dev, wss://... in prod) for voice
 *
 * Exported so tests can pin the shape.
 */
export function buildCspReportOnly(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'unsafe-inline' stays temporary — nonce-based CSP is a follow-up migration.
    // Next 15 emits inline runtime glue that a strict CSP would block.
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    // Supabase auth + REST + realtime hosts, plus our own api over ws/wss.
    'connect-src': [
      "'self'",
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'ws://localhost:3001',
      'wss://localhost:3001',
      process.env.NEXT_PUBLIC_API_BASE_URL ?? '',
      process.env.NEXT_PUBLIC_API_WS_URL ?? '',
    ].filter((s) => s.length > 0),
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https://*.supabase.co'],
    'object-src': ["'none'"],
    'report-uri': ['/api/csp-report'],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}
