import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LiveSessionShell } from './live-shell';

export const dynamic = 'force-dynamic';

/**
 * Browser-only live interview mode.
 *
 * Equivalent to the desktop app's overlay — captures interviewer audio via
 * getDisplayMedia + optional candidate mic, streams to the api's /ws/session, renders
 * transcripts and AI answers live. No install required. Works on any Chromium browser
 * (Chrome / Edge / Brave / Arc) and Firefox (with audio-share when available).
 */
export default async function LivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/app/live');

  const wsUrl =
    process.env.NEXT_PUBLIC_API_WS_URL ??
    (process.env.NEXT_PUBLIC_API_BASE_URL
      ? process.env.NEXT_PUBLIC_API_BASE_URL.replace(/^http/, 'ws')
      : 'ws://localhost:3001');

  // Pre-fetch the user's resumes + JDs so the config sheet can render without a client
  // round-trip before the user clicks Start. Only the fields the picker needs; cheap.
  const [{ data: resumes }, { data: jds }] = await Promise.all([
    supabase
      .from('resumes')
      .select('id, name, is_default')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('job_descriptions')
      .select('id, title')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  return (
    <div className="min-h-[calc(100vh-0px)] bg-ink-900">
      <LiveSessionShell
        wsUrl={wsUrl}
        resumes={(resumes ?? []) as { id: string; name: string; is_default: boolean }[]}
        jds={(jds ?? []) as { id: string; title: string }[]}
      />
    </div>
  );
}
