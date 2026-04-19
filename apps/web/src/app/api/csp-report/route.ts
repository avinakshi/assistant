/**
 * CSP report collector. The `Content-Security-Policy-Report-Only` header points the
 * browser here; we log whatever the browser sends and return 204.
 *
 * Intentionally minimal: no DB write, no auth. CSP reports are public anyway (they leak
 * your own page structure to whoever you send them to). Rate-limiting is something
 * Vercel/Cloudflare handle at the edge.
 *
 * Once the reports settle (a week of baseline traffic producing no new kinds of
 * violations), we flip the middleware header from `content-security-policy-report-only`
 * to `content-security-policy` to enforce.
 */
import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    // Log to stdout so deploys capture it. Cap the body size to 4 KB; real CSP reports
    // are always small, and a runaway one shouldn't flood the log.
    const truncated = body.length > 4_000 ? body.slice(0, 4_000) + '\u2026' : body;
    // eslint-disable-next-line no-console
    console.warn('[csp-report]', truncated);
  } catch {
    /* ignore — malformed bodies happen and aren't worth escalating */
  }
  return new NextResponse(null, { status: 204 });
}

// Some browsers (WebKit) send with `Content-Type: application/csp-report` which
// Next's built-in body parsing rejects as "unsupported". We read via request.text()
// above instead, so no special config is needed beyond this export for clarity.
export const dynamic = 'force-dynamic';
