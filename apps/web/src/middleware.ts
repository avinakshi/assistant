/**
 * Next.js middleware — refreshes the Supabase session cookie on every request + gates
 * /app/* routes behind auth. Uses @supabase/ssr's createServerClient because `cookies()`
 * isn't available inside middleware; we pass req/res cookies explicitly.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
    return NextResponse.redirect(url);
  }
  if (isAuthPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip middleware for static assets + auth callback (the callback manages its own
  // session swap and we don't want to redirect mid-flow).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback).*)'],
};
