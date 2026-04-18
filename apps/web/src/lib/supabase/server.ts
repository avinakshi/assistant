/**
 * Supabase client for server components, route handlers, and middleware.
 *
 * Uses @supabase/ssr's cookie storage so the Next.js request lifecycle can read + refresh
 * the user's auth token on each request.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

interface CookieEntry {
  name: string;
  value: string;
  options?: CookieOptions;
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieEntry[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              // Spread options only when present — Next.js cookies().set rejects
              // `undefined` as the 3rd argument under exactOptionalPropertyTypes.
              if (options) cookieStore.set({ name, value, ...options });
              else cookieStore.set(name, value);
            });
          } catch {
            // `cookies().set()` throws in read-only contexts (e.g. server components).
            // Middleware handles refresh; this swallow is expected.
          }
        },
      },
    },
  );
}
