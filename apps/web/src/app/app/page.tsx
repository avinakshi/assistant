import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatMinutes, planDisplayName, readUsageSnapshot } from '@/lib/usage';

export const dynamic = 'force-dynamic';

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0];

  const [{ data: resumes }, { data: jds }, { data: personas }, usage] = await Promise.all([
    supabase.from('resumes').select('id, name, is_default').order('created_at', { ascending: false }),
    supabase
      .from('job_descriptions')
      .select('id, company, role')
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('personas')
      .select('id, name, is_default')
      .order('created_at', { ascending: false }),
    readUsageSnapshot(supabase),
  ]);

  const defaultResume = resumes?.find((r) => r.is_default) ?? resumes?.[0];
  const defaultPersona = personas?.find((p) => p.is_default);

  const planLabel = planDisplayName(usage.plan);
  const usageHeader =
    usage.weeklyLimitSeconds === null
      ? `${planLabel} tier · unlimited live minutes`
      : `${planLabel} tier · ${formatMinutes(usage.usedSeconds)} used of ${formatMinutes(usage.weeklyLimitSeconds)} this week`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">
        Welcome{firstName ? `, ${firstName}` : ''}.
      </h1>
      <p className="mt-1 text-sm text-ink-500">{usageHeader}</p>

      <UsageCard usage={usage} />

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <SetupCard
          title="Resume"
          status={defaultResume ? 'ready' : 'missing'}
          badge={defaultResume?.name ?? undefined}
          body={
            defaultResume
              ? `Using "${defaultResume.name}" as default. The LLM feeds on this for every answer.`
              : 'Upload a PDF or DOCX so the LLM can reference your real companies, titles, and projects.'
          }
          href="/app/resumes"
          cta={defaultResume ? 'Manage' : 'Upload resume'}
        />
        <SetupCard
          title="Job descriptions"
          status={(jds?.length ?? 0) > 0 ? 'ready' : 'missing'}
          badge={jds?.[0] ? `${jds[0].role ?? 'JD'} · ${jds[0].company ?? ''}`.trim() : undefined}
          body={
            (jds?.length ?? 0) > 0
              ? `${jds!.length} saved. Attach the right one at session start.`
              : 'Paste a JD or its URL so the LLM can tailor answers to the role.'
          }
          href="/app/jds"
          cta={(jds?.length ?? 0) > 0 ? 'Manage' : 'Add JD'}
        />
        <SetupCard
          title="Persona"
          status="optional"
          badge={defaultPersona?.name ?? undefined}
          body={
            defaultPersona
              ? `Default: "${defaultPersona.name}". Layered on top of the built-in prompt pack.`
              : 'Optional. Custom system prompts for niche interviews (SRE, MLOps, A11y).'
          }
          href="/app/personas"
          cta={defaultPersona ? 'Manage' : 'Add persona'}
        />
        <div className="rounded-xl border border-ink-100 bg-white p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Warm up
          </div>
          <div className="mt-1 text-lg font-semibold">Practice with an AI interviewer</div>
          <p className="mt-2 text-sm text-ink-700">
            Behavioral, coding, or system design. You type; the AI asks follow-ups and
            scores each answer at the end.
          </p>
          <Link
            href="/app/practice"
            className="mt-4 inline-block rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Start practice
          </Link>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-ink-100 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Next step
        </div>
        <div className="mt-1 text-lg font-semibold">Open the desktop app</div>
        <p className="mt-2 text-sm text-ink-700">
          Live interviews run on your Mac / Windows machine, not in the browser. Grab
          the installer from the latest GitHub Release, or use the dev build below.
        </p>
        <code className="mt-3 block rounded bg-ink-50 p-3 text-xs font-mono text-ink-700">
          AUDIO_SOURCE=native WS_ROUTE=session \{'\n'}
          apps/desktop/node_modules/.bin/electron apps/desktop/dist/main/index.js
        </code>
      </section>
    </div>
  );
}

function UsageCard({ usage }: { usage: Awaited<ReturnType<typeof readUsageSnapshot>> }) {
  const unlimited = usage.weeklyLimitSeconds === null;
  const pct = unlimited
    ? 0
    : Math.min(100, Math.round((usage.usedSeconds / (usage.weeklyLimitSeconds || 1)) * 100));
  const bar =
    pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="mt-6 rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          This week’s live usage
        </div>
        <Link
          href="/app/billing"
          className="text-xs font-medium text-brand-600 hover:underline"
        >
          {unlimited ? 'View plan' : 'Upgrade'}
        </Link>
      </div>
      {unlimited ? (
        <div className="mt-3 text-sm text-ink-700">
          You’re on {planDisplayName(usage.plan)}. No weekly cap— run as many sessions as you need.
        </div>
      ) : (
        <>
          <div className="mt-3 text-sm text-ink-700">
            {formatMinutes(usage.usedSeconds)} used ·{' '}
            {formatMinutes(usage.remainingSeconds ?? 0)} remaining
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-50">
            <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
          </div>
          {pct >= 100 && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              Weekly quota exhausted. New sessions are blocked until the rolling window
              clears, or upgrade to keep going.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SetupCard({
  title,
  status,
  badge,
  body,
  href,
  cta,
}: {
  title: string;
  status: 'ready' | 'missing' | 'optional';
  badge: string | undefined;
  body: string;
  href: string;
  cta: string;
}) {
  const statusStyle =
    status === 'ready'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'missing'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-ink-50 text-ink-500';
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-6">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">{title}</div>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyle}`}>{status}</span>
      </div>
      {badge && (
        <div className="mt-1 truncate text-lg font-semibold" title={badge}>
          {badge}
        </div>
      )}
      <p className="mt-2 text-sm text-ink-700">{body}</p>
      <Link
        href={href}
        className="mt-4 inline-block rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
      >
        {cta}
      </Link>
    </div>
  );
}
