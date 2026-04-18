/**
 * OAuth / magic-link callback. Supabase redirects here with a `code` query param; we
 * exchange it for a session cookie, then push the user to `?next=…` (defaults to /app).
 *
 * Phase 6e: when the login was initiated by the desktop app (`?from=desktop&state=<nonce>`),
 * we don't send the user back into the web dashboard. Instead, we read the freshly minted
 * session and return an HTML interstitial that navigates the browser to
 * `ic://auth-callback?state=…&access_token=…&refresh_token=…&expires_at=…&user_id=…`.
 * The OS dispatches that custom scheme to the registered Electron app.
 *
 * We can't do this with a plain 302: Chrome and Safari both strip non-http(s) schemes
 * from Location headers for security reasons. A JS-driven `window.location` works
 * reliably because it runs after the HTML is loaded on localhost / the user's origin.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/app';
  const from = searchParams.get('from');
  const state = searchParams.get('state');
  const isDesktop = from === 'desktop' && typeof state === 'string' && state.length > 0;

  if (!code) {
    return redirectToLoginWithError(origin, 'callback');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectToLoginWithError(origin, 'callback');
  }

  if (!isDesktop) {
    return NextResponse.redirect(new URL(next, origin));
  }

  // Desktop branch: read the session that exchangeCodeForSession just wrote and hand
  // the tokens off to the Electron app via the ic:// custom protocol.
  const { data, error: sessionErr } = await supabase.auth.getSession();
  const session = data?.session;
  if (sessionErr || !session) {
    return redirectToLoginWithError(origin, 'callback');
  }

  const ic = new URL(`ic://auth-callback`);
  ic.searchParams.set('state', state);
  ic.searchParams.set('access_token', session.access_token);
  ic.searchParams.set('refresh_token', session.refresh_token);
  ic.searchParams.set(
    'expires_at',
    // Supabase returns expires_at as unix seconds. Fall back to now + expires_in
    // (seconds) if, for any reason, expires_at is missing.
    String(session.expires_at ?? Math.floor(Date.now() / 1_000) + (session.expires_in ?? 3600)),
  );
  ic.searchParams.set('user_id', session.user.id);
  if (session.user.email) ic.searchParams.set('email', session.user.email);

  return new NextResponse(renderHandoffHtml(ic.toString()), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function redirectToLoginWithError(origin: string, code: string): NextResponse {
  const errorUrl = new URL('/login', origin);
  errorUrl.searchParams.set('error', code);
  return NextResponse.redirect(errorUrl);
}

function renderHandoffHtml(icUrl: string): string {
  // Keep this page minimal. The <meta refresh> is a belt-and-braces fallback: if JS is
  // disabled, the browser still tries the custom scheme navigation.
  const escaped = escapeHtml(icUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Interview Copilot \u2014 returning to desktop\u2026</title>
    <meta http-equiv="refresh" content="1;url=${escaped}" />
    <style>
      body { font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #111; max-width: 420px; margin: 8rem auto; padding: 0 1rem; }
      h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 .5rem; }
      p  { color: #555; }
      a.btn { display: inline-block; margin-top: 1rem; padding: .6rem 1rem; border-radius: .4rem; background: #111; color: #fff; text-decoration: none; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4f4f5; padding: 1px 4px; border-radius: 3px; }
    </style>
  </head>
  <body>
    <h1>Signing you in to Interview Copilot\u2026</h1>
    <p>We\u2019re handing off to the desktop app. If the window doesn\u2019t switch automatically, click the button below.</p>
    <a class="btn" id="ret" href="${escaped}">Return to Interview Copilot</a>
    <p style="margin-top:2rem; color:#888;">You can close this tab once the app is focused.</p>
    <script>
      // Kick off the custom-scheme navigation as soon as the page is interactive.
      window.location.replace(${JSON.stringify(icUrl)});
    </script>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
