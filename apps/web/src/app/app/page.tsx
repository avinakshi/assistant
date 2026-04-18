import { createClient } from '@/lib/supabase/server';

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">
        Welcome{firstName ? `, ${firstName}` : ''}.
      </h1>
      <p className="mt-1 text-sm text-ink-500">Free tier · 10 live minutes / week</p>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-ink-100 bg-white p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Next step
          </div>
          <div className="mt-1 text-lg font-semibold">Download the desktop app</div>
          <p className="mt-2 text-sm text-ink-700">
            The assistant runs on your machine, not in the browser. The desktop installer lands
            when we wire the release pipeline (Phase 7). For now, run the local dev build.
          </p>
          <code className="mt-3 block rounded bg-ink-50 p-3 text-xs font-mono text-ink-700">
            pnpm --filter @repo/desktop build &amp;&amp; AUDIO_SOURCE=native WS_ROUTE=session \{'\n'}
            apps/desktop/node_modules/.bin/electron apps/desktop/dist/main/index.js
          </code>
        </div>
        <div className="rounded-xl border border-ink-100 bg-white p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Recent sessions
          </div>
          <p className="mt-3 text-sm text-ink-500">
            No sessions yet. Start a practice run from the desktop app.
          </p>
        </div>
      </section>
    </div>
  );
}
