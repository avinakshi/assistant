import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GotItButton } from './got-it-button';

export const dynamic = 'force-dynamic';

/**
 * First-run onboarding. Shown once — middleware routes first-time users here until
 * `profiles.onboarded_at` is set (see apps/web/src/middleware.ts). The "Got it" button
 * stamps onboarded_at and redirects to /app.
 */
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/welcome');

  const firstName =
    (user.user_metadata?.full_name as string | undefined)?.split(' ')[0] ?? '';

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">
        Welcome{firstName ? `, ${firstName}` : ''}.
      </h1>
      <p className="mt-3 text-base text-ink-700">
        You&apos;re signed in as <span className="font-medium">{user.email}</span>. Here
        are the four surfaces you’ll use — start with whichever one fits today.
      </p>

      <ol className="mt-8 flex flex-col gap-4">
        <Step
          index={1}
          title="Practice alone"
          body="Warm up with an AI interviewer. Behavioral, coding, or system design. Text-only or with voice. Results save under Sessions."
          href="/app/practice"
          cta="Open practice"
        />
        <Step
          index={2}
          title="Install the desktop app"
          body="The live interview overlay runs on your machine — WASAPI loopback captures the interviewer's audio, invisible to screen capture. Download below; it signs in to this account automatically."
          href="https://github.com/avinakshi/assistant/releases"
          cta="Get the desktop app"
          external
        />
        <Step
          index={3}
          title="Install the Chrome extension"
          body="One-click AI solutions to LeetCode + HackerRank problems while you're on the page. Pairs with your session automatically."
          href="https://github.com/avinakshi/assistant/tree/main/apps/extension#install"
          cta="Load the extension"
          external
        />
        <Step
          index={4}
          title="Settings"
          body="Control whether live session transcripts are saved, create long-lived API keys, grab your Chrome extension session JSON."
          href="/app/settings"
          cta="Open settings"
        />
      </ol>

      <div className="mt-10 flex items-center gap-4">
        <GotItButton />
        <span className="text-xs text-ink-500">This page won&apos;t show again.</span>
      </div>
    </main>
  );
}

function Step({
  index,
  title,
  body,
  href,
  cta,
  external,
}: {
  readonly index: number;
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly cta: string;
  readonly external?: boolean;
}) {
  const link = external ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      {cta} →
    </a>
  ) : (
    <Link
      href={href}
      className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      {cta} →
    </Link>
  );
  return (
    <li className="flex items-start gap-4 rounded-xl border border-ink-100 bg-white p-5">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700"
      >
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        <p className="mt-1 text-sm text-ink-700">{body}</p>
        {link}
      </div>
    </li>
  );
}
