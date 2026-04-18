/**
 * OAuth / magic-link callback. Supabase redirects here with a `code` query param; we
 * exchange it for a session cookie, then push the user to `?next=…` (defaults to /app).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/app';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Auth failed or no code present — send the user back to /login with a friendly note.
  const errorUrl = new URL('/login', origin);
  errorUrl.searchParams.set('error', 'callback');
  return NextResponse.redirect(errorUrl);
}
