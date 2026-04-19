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
  const extensionId = searchParams.get('extension_id');
  const isDesktop = from === 'desktop' && typeof state === 'string' && state.length > 0;
  // Phase 10c: Chrome extension IDs are exactly 32 lowercase [a-p] letters. Anything else
  // fails validation — we don't want to redirect to a random chrome-extension://… URL.
  const isExtension =
    from === 'extension' &&
    typeof state === 'string' &&
    state.length > 0 &&
    typeof extensionId === 'string' &&
    /^[a-p]{32}$/.test(extensionId);

  if (!code) {
    return redirectToLoginWithError(origin, 'callback');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectToLoginWithError(origin, 'callback');
  }

  if (!isDesktop && !isExtension) {
    return NextResponse.redirect(new URL(next, origin));
  }

  const { data, error: sessionErr } = await supabase.auth.getSession();
  const session = data?.session;
  if (sessionErr || !session) {
    return redirectToLoginWithError(origin, 'callback');
  }

  const expiresAt =
    session.expires_at ?? Math.floor(Date.now() / 1_000) + (session.expires_in ?? 3600);

  if (isDesktop) {
    // Desktop branch: ic:// custom protocol, dispatched by the OS to Electron.
    const ic = new URL(`ic://auth-callback`);
    ic.searchParams.set('state', state);
    ic.searchParams.set('access_token', session.access_token);
    ic.searchParams.set('refresh_token', session.refresh_token);
    ic.searchParams.set('expires_at', String(expiresAt));
    ic.searchParams.set('user_id', session.user.id);
    if (session.user.email) ic.searchParams.set('email', session.user.email);
    return new NextResponse(renderHandoffHtml(ic.toString(), 'desktop'), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // Extension branch: navigate the tab to chrome-extension://<id>/callback.html with
  // the session tokens as query params. The extension's callback page verifies the
  // state nonce before persisting anything.
  const ext = new URL(`chrome-extension://${extensionId}/callback.html`);
  ext.searchParams.set('state', state!);
  ext.searchParams.set('access_token', session.access_token);
  ext.searchParams.set('refresh_token', session.refresh_token);
  ext.searchParams.set('expires_at', String(expiresAt));
  ext.searchParams.set('supabase_url', process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  ext.searchParams.set('supabase_anon_key', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '');
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (apiBaseUrl) ext.searchParams.set('api_base_url', apiBaseUrl);
  return new NextResponse(renderHandoffHtml(ext.toString(), 'extension'), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function redirectToLoginWithError(origin: string, code: string): NextResponse {
  const errorUrl = new URL('/login', origin);
  errorUrl.searchParams.set('error', code);
  return NextResponse.redirect(errorUrl);
}

function renderHandoffHtml(destUrl: string, mode: 'desktop' | 'extension'): string {
  // Keep this page minimal. The <meta refresh> is a belt-and-braces fallback: if JS is
  // disabled, the browser still tries the custom scheme navigation.
  const escaped = escapeHtml(destUrl);
  const target = mode === 'desktop' ? 'the desktop app' : 'the Chrome extension';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Interview Copilot \u2014 handing off\u2026</title>
    <meta http-equiv="refresh" content="1;url=${escaped}" />
    <style>
      body { font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #111; max-width: 420px; margin: 8rem auto; padding: 0 1rem; }
      h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 .5rem; }
      p  { color: #555; }
      a.btn { display: inline-block; margin-top: 1rem; padding: .6rem 1rem; border-radius: .4rem; background: #111; color: #fff; text-decoration: none; }
    </style>
  </head>
  <body>
    <h1>Signing you in to Interview Copilot\u2026</h1>
    <p>We\u2019re handing off to ${target}. If the window doesn\u2019t switch automatically, click the button below.</p>
    <a class="btn" href="${escaped}">Return to Interview Copilot</a>
    <p style="margin-top:2rem; color:#888;">You can close this tab once the app is focused.</p>
    <script>
      window.location.replace(${JSON.stringify(destUrl)});
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
