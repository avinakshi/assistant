import Link from 'next/link';

export const metadata = {
  title: 'Terms of service — Interview Copilot',
  description: 'Terms under which you can use Interview Copilot.',
};

export default function TermsPage() {
  const updated = 'April 19, 2026';
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-ink-500 hover:text-ink-900">
        ← Home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">Terms of service</h1>
      <p className="mt-1 text-sm text-ink-500">Last updated {updated}</p>

      <Section title="1. What Interview Copilot is">
        <p>
          A set of tools to help you practice + deliver technical interviews. A desktop
          overlay captures your interviewer’s audio and suggests answers in real
          time. A web dashboard stores your resumes, job descriptions, and practice
          history. A Chrome extension provides coding-problem assistance.
        </p>
      </Section>

      <Section title="2. Your responsibilities">
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-700">
          <li>
            <strong>Consent.</strong> Many jurisdictions require two-party consent to
            record a conversation. You are responsible for confirming you’re allowed
            to capture the interviewer’s audio in your jurisdiction and on the
            platform you’re using.
          </li>
          <li>
            <strong>Interview integrity.</strong> Some employers forbid the use of AI
            assistants during their interviews. Using Interview Copilot in violation of
            an explicit no-AI rule is on you, not us.
          </li>
          <li>
            <strong>Account security.</strong> Don’t share your account, session
            tokens, or API keys. You’re responsible for activity under your account.
          </li>
        </ul>
      </Section>

      <Section title="3. Acceptable use">
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-700">
          <li>
            Don’t use the service to generate content that’s illegal where
            you are, nor to harass or impersonate others.
          </li>
          <li>
            Don’t try to bypass rate limits, quota, or auth. Don’t scrape the
            api beyond your own quota.
          </li>
          <li>
            Don’t upload sensitive regulated data (health records, payment card
            numbers, government IDs). We’re not certified for those.
          </li>
        </ul>
      </Section>

      <Section title="4. Plans + billing">
        <p>
          Free tier comes with 10 live minutes per rolling 7 days. Paid tiers ship
          next; their limits + pricing are on the pricing page. You can delete your
          account at any time; paid invoices already rendered are non-refundable except
          where required by law.
        </p>
      </Section>

      <Section title="5. Data">
        <p>
          See the <Link href="/privacy" className="text-brand-600 hover:underline">privacy policy</Link>{' '}
          for a detailed breakdown. Short version: we store the minimum; you control
          whether transcripts are kept; we don’t sell data.
        </p>
      </Section>

      <Section title="6. No warranty">
        <p>
          The AI answers suggestions are generated. They may be incorrect, outdated, or
          inappropriate for your context. Treat them as a draft a human (you) edits and
          speaks. Interview Copilot is provided &ldquo;as is&rdquo; without warranty of any kind.
        </p>
      </Section>

      <Section title="7. Limitation of liability">
        <p>
          To the maximum extent permitted by law, Interview Copilot and its
          contributors are not liable for any indirect, incidental, special, or
          consequential damages arising from your use of the service. Aggregate
          liability is capped at the fees you paid in the 12 months before the claim.
        </p>
      </Section>

      <Section title="8. Termination">
        <p>
          You can delete your account any time. We can suspend or terminate accounts
          that violate these terms, abuse rate limits, or incur abuse costs that
          exceed reasonable usage.
        </p>
      </Section>

      <Section title="9. Governing law">
        <p>
          These terms are governed by the laws of India. Disputes go to courts in
          Bengaluru unless a different venue is required by consumer protection law
          in your jurisdiction.
        </p>
      </Section>

      <Section title="10. Changes">
        <p>
          Meaningful changes get emailed to your account 14 days before taking effect.
          Continued use after that is acceptance. If you disagree, close your account
          before the effective date.
        </p>
      </Section>

      <div className="mt-12 flex gap-4 text-sm">
        <Link href="/privacy" className="text-brand-600 hover:underline">
          ← Privacy policy
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
