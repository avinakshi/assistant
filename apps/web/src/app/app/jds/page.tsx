import { createClient } from '@/lib/supabase/server';
import { JdForm } from './jd-form';
import { JdRow } from './jd-row';

export const dynamic = 'force-dynamic';

interface JdListItem {
  id: string;
  company: string | null;
  role: string | null;
  source_url: string | null;
  body: string;
  created_at: string;
}

export default async function JdsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('job_descriptions')
    .select('id, company, role, source_url, body, created_at')
    .order('created_at', { ascending: false });

  const jds: JdListItem[] = (data as JdListItem[] | null) ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Job descriptions</h1>
      <p className="mt-1 text-sm text-ink-500">
        Paste the JD text directly, or paste a URL and we&apos;ll fetch the page. Company
        and role auto-fill from the page title when we can read it.
      </p>

      <div className="mt-6 rounded-xl border border-ink-100 bg-white p-6 shadow-sm">
        <JdForm />
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Saved JDs</h2>
        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Failed to load: {error.message}
          </div>
        )}
        {jds.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-ink-100 bg-white p-6 text-sm text-ink-500">
            No JDs yet. Save at least one so the LLM can tailor answers to the role you&apos;re
            interviewing for.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-100 bg-white">
            {jds.map((j) => (
              <JdRow
                key={j.id}
                id={j.id}
                company={j.company}
                role={j.role}
                sourceUrl={j.source_url}
                excerpt={j.body.slice(0, 240)}
                createdAt={j.created_at}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
