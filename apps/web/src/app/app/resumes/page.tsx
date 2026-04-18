import { createClient } from '@/lib/supabase/server';
import { UploadForm } from './upload-form';
import { ResumeRow } from './resume-row';

export const dynamic = 'force-dynamic';

interface ResumeListItem {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  parsed_text: string | null;
}

export default async function ResumesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('resumes')
    .select('id, name, is_default, created_at, parsed_text')
    .order('created_at', { ascending: false });

  const resumes: ResumeListItem[] = (data as ResumeListItem[] | null) ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Resumes</h1>
      <p className="mt-1 text-sm text-ink-500">
        Upload a PDF, DOCX, or TXT. We extract the text and Gemini summarizes key fields — the
        session orchestrator feeds this to the LLM as interview context.
      </p>

      <div className="mt-6 rounded-xl border border-ink-100 bg-white p-6 shadow-sm">
        <UploadForm />
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
          Your resumes
        </h2>
        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Failed to load: {error.message}
          </div>
        )}
        {resumes.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-ink-100 bg-white p-6 text-sm text-ink-500">
            No resumes yet. Upload one above — you&apos;ll need at least one to attach to a live
            session.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-100 bg-white">
            {resumes.map((r) => (
              <ResumeRow
                key={r.id}
                id={r.id}
                name={r.name}
                isDefault={r.is_default}
                createdAt={r.created_at}
                excerpt={r.parsed_text?.slice(0, 240) ?? ''}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
