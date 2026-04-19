import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 text-ink-900">
      <header className="mb-16 flex items-center justify-between">
        <span className="text-sm font-semibold">Interview Copilot</span>
        <nav className="flex gap-4 text-sm text-ink-700">
          <Link href="/pricing" className="hover:text-ink-900">
            Pricing
          </Link>
          <Link
            href="/login"
            className="rounded bg-brand-600 px-3 py-1.5 text-white transition hover:bg-brand-700"
          >
            Log in
          </Link>
        </nav>
      </header>

      <section className="grid gap-10 lg:grid-cols-2">
        <div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            A quieter, smarter interview assistant.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-ink-700">
            Real-time help during practice, preparation, and real interviews. Indian-English
            tone. Under one second from question to answer. A third of Parakeet&apos;s price.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              href="/login"
              className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Start free
            </Link>
            <Link
              href="/pricing"
              className="rounded-md border border-ink-100 bg-white px-5 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-xs text-ink-500">
            A preparation tool. Follow your interviewer&apos;s rules on AI assistance.
          </p>
        </div>
        <div className="rounded-xl border border-ink-100 bg-white p-6 shadow-sm">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
            What it does
          </div>
          <ul className="flex flex-col gap-3 text-sm text-ink-700">
            <li>📝 Transcribes your interviewer live (Deepgram Nova-3).</li>
            <li>🧠 Suggests a first-person answer in under a second.</li>
            <li>🧊 Overlay invisible to Zoom / Teams / Meet screen share.</li>
            <li>🖥️ Coding mode: screenshot a LeetCode problem, get code.</li>
            <li>🎙️ Practice mode: voice-agent mock interviews with scoring.</li>
            <li>📊 Post-session review: what went well, what to tighten.</li>
          </ul>
        </div>
      </section>

      <section className="mt-24 rounded-xl border border-ink-100 bg-white p-8">
        <h2 className="text-xl font-semibold">Why Indian-English tone matters</h2>
        <p className="mt-2 max-w-2xl text-ink-700">
          Generic LLM output sounds like a pitch deck. We write how you actually speak —
          warm, specific, modest about claims, confident about facts. First-person. No
          &ldquo;leverage&rdquo;, no &ldquo;synergy&rdquo;. Our banned-word filter enforces
          this in real time.
        </p>
      </section>

      <footer className="mt-24 flex items-center justify-between border-t border-ink-100 pt-8 text-xs text-ink-500">
        <span>© Interview Copilot</span>
        <nav className="flex gap-4">
          <Link href="/pricing">Pricing</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </main>
  );
}
