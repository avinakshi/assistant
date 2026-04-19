/**
 * Dashboard layout — sidebar nav + top bar. Middleware already enforced auth for /app/*,
 * so we can render the sidebar unconditionally and assume `user` exists.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SignOutButton } from './sign-out-button';

const NAV = [
  { href: '/app', label: 'Home' },
  { href: '/app/live', label: 'Live' },
  { href: '/app/practice', label: 'Practice' },
  { href: '/app/sessions', label: 'Sessions' },
  { href: '/app/resumes', label: 'Resumes' },
  { href: '/app/jds', label: 'Job descriptions' },
  { href: '/app/personas', label: 'Personas' },
  { href: '/app/settings', label: 'Settings' },
  { href: '/app/billing', label: 'Billing' },
  { href: '/app/help', label: 'Help' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware should have redirected unauth'd users already; belt-and-braces here.
  if (!user) redirect('/login?next=/app');

  return (
    <div className="flex min-h-screen">
      {/* Skip-to-content link for keyboard users — visible only on focus so it stays out
          of the sighted layout. */}
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <aside
        aria-label="Primary navigation"
        className="hidden w-56 shrink-0 flex-col border-r border-ink-100 bg-white p-4 md:flex"
      >
        <Link href="/app" className="mb-6 block text-sm font-semibold text-ink-900">
          Interview Copilot
        </Link>
        <nav className="flex flex-col gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-2 py-1.5 text-ink-700 transition hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto pt-4 text-xs text-ink-500">
          <div className="truncate" title={user.email ?? undefined}>
            {user.email}
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main id="app-main" className="flex-1 bg-ink-50">
        {children}
      </main>
    </div>
  );
}
