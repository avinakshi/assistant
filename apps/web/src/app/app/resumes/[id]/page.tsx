import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { StructuredResumeEditor } from './editor';

export const dynamic = 'force-dynamic';

interface ResumeRow {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  parsed_text: string | null;
  structured_json: Record<string, unknown> | null;
}

export default async function ResumeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('resumes')
    .select('id, name, is_default, created_at, parsed_text, structured_json')
    .eq('id', id)
    .maybeSingle();
  const resume = data as ResumeRow | null;
  if (!resume) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-ink-500">Resume</div>
          <h1 className="mt-0.5 text-xl font-semibold">{resume.name}</h1>
          <div className="mt-1 text-xs text-ink-500">
            Uploaded {new Date(resume.created_at).toLocaleDateString()}
            {resume.is_default ? ' · default' : ''}
          </div>
        </div>
        <Link
          href="/app/resumes"
          className="text-xs text-ink-500 hover:text-ink-900 hover:underline"
        >
          ← All resumes
        </Link>
      </div>

      <StructuredResumeEditor
        resumeId={resume.id}
        initial={resume.structured_json ?? null}
        rawText={resume.parsed_text ?? ''}
      />
    </div>
  );
}
