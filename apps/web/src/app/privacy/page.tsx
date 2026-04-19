import Link from 'next/link';

export const metadata = {
  title: 'Privacy policy — Interview Copilot',
  description: 'What data Interview Copilot collects and how it uses it.',
};

export default function PrivacyPage() {
  const updated = 'April 19, 2026';
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-ink-500 hover:text-ink-900">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">Privacy policy</h1>
      <p className="mt-1 text-sm text-ink-500">Last updated {updated}</p>

      <Section title="Summary">
        <p>
          Interview Copilot captures the interviewer’s voice during a live session
          so it can generate AI answers for you in real time. We keep the minimum data
          needed to deliver that product. We never sell data. Most transcript data is
          opt-in and deletable. Audio is streamed through a speech-to-text provider and
          is not stored by us.
        </p>
      </Section>

      <Section title="What we collect">
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-700">
          <li>
            <strong>Account.</strong> Email address and anything Supabase Auth stores
            when you sign in (Google OAuth profile basics if you use it).
          </li>
          <li>
            <strong>Session metadata.</strong> For every live or practice session we
            record its start / end timestamps, mode, duration, and LLM used. This is
            needed for the weekly usage meter.
          </li>
          <li>
            <strong>Session transcripts + AI answers</strong> — only when
            <em> Save live session transcripts</em> is on under Settings. You can delete
            any session at any time from <code>/app/sessions</code>.
          </li>
          <li>
            <strong>Practice content.</strong> Resumes, job descriptions, personas, and
            practice-session Q/A pairs you enter. Stored until you delete them.
          </li>
          <li>
            <strong>Operational logs.</strong> Per-request logs with timestamps, chars
            processed, and latencies. We deliberately don’t log transcript or answer
            text in these logs.
          </li>
        </ul>
      </Section>

      <Section title="What leaves our servers">
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-700">
          <li>
            <strong>Audio</strong> → Deepgram (Nova-3) for transcription. Streamed,
            not stored by us. Deepgram’s retention is governed by their policy.
          </li>
          <li>
            <strong>Transcripts + your resume/JD context</strong> → Gemini
            (Google AI) or Anthropic’s Claude, depending on your tier, to generate
            answers. We don’t keep a copy beyond the session DB unless you enabled
            persistence.
          </li>
          <li>
            <strong>Screenshots</strong> → Google Cloud Vision for OCR on the coding
            workflow. The raw PNG is not stored by us.
          </li>
        </ul>
        <p className="mt-3 text-ink-700">
          Each provider is contractually bound to use the data only to serve the
          request. No provider above is authorized to train a model on your data.
        </p>
      </Section>

      <Section title="Your controls">
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-700">
          <li>Toggle transcript persistence in Settings.</li>
          <li>Delete any session from <code>/app/sessions</code> — cascades to
            every related event + summary.</li>
          <li>Revoke API keys from <code>/app/settings</code>.</li>
          <li>
            Request export or full deletion by emailing the address in our support
            channel. We’ll respond within 30 days as required by GDPR / DPDP.
          </li>
        </ul>
      </Section>

      <Section title="Cookies + analytics">
        <p>
          Supabase auth cookies are used to keep you signed in. We don’t run any
          analytics or tracking scripts. No third-party ads, no cross-site tracking.
        </p>
      </Section>

      <Section title="Jurisdiction">
        <p>
          Data is stored in Supabase’s ap-south-1 region (Mumbai, India). If you
          prefer a different region, email us before signing up — we can route you
          to a separate project.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We’ll update this page when things change materially. Meaningful changes
          go out via email to your account.
        </p>
      </Section>

      <div className="mt-12 flex gap-4 text-sm">
        <Link href="/terms" className="text-brand-600 hover:underline">
          Terms of service →
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      <div className="mt-2 text-sm text-ink-700">{children}</div>
    </section>
  );
}
