/**
 * Next.js middleware — refreshes the Supabase session cookie on every request + gates
 * /app/* routes behind auth. Uses @supabase/ssr's createServerClient because `cookies()`
 * isn't available inside middleware; we pass req/res cookies explicitly.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { applySecurityHeaders } from './lib/security-headers';

interface CookieEntry {
  name: string;
  value: string;
  options?: CookieOptions;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieEntry[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            if (options) response.cookies.set({ name, value, ...options });
            else response.cookies.set(name, value);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = pathname.startsWith('/app') || pathname.startsWith('/welcome');
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return applySecurityHeaders(NextResponse.redirect(url));
  }
  if (isAuthPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  // Phase 11b onboarding gate: first-time users land on /welcome until they dismiss it.
  // We only run the profile check on /app paths to keep the middleware's hot path cheap
  // for every other request.
  if (user && pathname.startsWith('/app')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarded_at')
      .eq('user_id', user.id)
      .maybeSingle();
    // `onboarded_at` is null on a fresh profile row (the trigger in migration 0001
    // inserts with NULL). Once set, the middleware stops redirecting.
    const needsOnboarding = !(profile as { onboarded_at?: string | null } | null)?.onboarded_at;
    if (needsOnboarding) {
      const url = request.nextUrl.clone();
      url.pathname = '/welcome';
      url.search = '';
      return applySecurityHeaders(NextResponse.redirect(url));
    }
  }

  return applySecurityHeaders(response);
}

export const config = {
  // Skip middleware for static assets + auth callback (the callback manages its own
  // session swap and we don't want to redirect mid-flow).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback).*)'],
};
