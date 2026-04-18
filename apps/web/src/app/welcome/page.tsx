import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Onboarding stub. Phase 6b fills this with: resume upload, JD paste, desktop download
 * buttons. For now, we just confirm the sign-in worked and bounce to the dashboard.
 */
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/welcome');

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Welcome.</h1>
      <p className="mt-3 text-lg text-ink-700">
        You&apos;re signed in as <span className="font-medium">{user.email}</span>.
      </p>
      <p className="mt-2 text-sm text-ink-500">
        Phase 6b turns this into a proper 3-step onboarding (resume → JD → desktop download).
      </p>
      <a
        href="/app"
        className="mt-6 inline-block rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Go to dashboard →
      </a>
    </main>
  );
}
