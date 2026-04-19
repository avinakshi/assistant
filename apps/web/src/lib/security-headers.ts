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
 *
 * Deliberately NO Content-Security-Policy. Getting CSP right with Next.js inline
 * styles + Supabase + third-party auth redirects is a separate migration that
 * demands dev-time CSP-reporting instrumentation. We'll add it in a later phase
 * with proper testing; shipping a broken CSP now would break silently in ways
 * the test suite wouldn't catch.
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
  return response;
}
