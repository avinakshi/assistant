import Link from 'next/link';
import { cn } from '@/lib/cn';

interface Plan {
  name: string;
  priceINR: string;
  priceUSD: string;
  headline: string;
  features: string[];
  highlight?: boolean;
  cta: string;
}

const PLANS: Plan[] = [
  {
    name: 'Free',
    priceINR: '₹0',
    priceUSD: '$0',
    headline: '10 min/week live · 1 practice/week',
    features: [
      'Gemini Flash answers',
      'English only',
      'Practice mode',
      'No resume context in live mode',
    ],
    cta: 'Start free',
  },
  {
    name: 'Starter',
    priceINR: '₹799/mo',
    priceUSD: '$9.99/mo',
    headline: '5 interviews/mo · unlimited practice',
    features: [
      'Claude or GPT-4.1 (your pick)',
      '5 languages',
      'Resume + JD context',
      'Screen OCR + coding mode',
      'Basic post-session review',
    ],
    cta: 'Start Starter',
  },
  {
    name: 'Pro',
    priceINR: '₹1,599/mo',
    priceUSD: '$19.99/mo',
    headline: 'Unlimited live + practice',
    features: [
      'All LLMs, Auto racing (Claude + GPT-5)',
      '10 languages',
      'Custom personas',
      'Full post-session review',
      'Priority queue',
    ],
    highlight: true,
    cta: 'Start Pro',
  },
  {
    name: 'Lifetime',
    priceINR: '₹7,999 once',
    priceUSD: '$99 once',
    headline: '50 interviews/mo forever',
    features: [
      'All Pro features',
      '3 years of free upgrades',
      '50% off upgrades after',
      'Great if you interview often',
    ],
    cta: 'Buy Lifetime',
  },
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16 text-ink-900">
      <header className="mb-12 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold">
          Interview Copilot
        </Link>
        <Link
          href="/login"
          className="rounded bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
        >
          Log in
        </Link>
      </header>
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <p className="mt-2 max-w-2xl text-ink-700">
        Priced for India first. International cards work too (Stripe). 30-day refund on any
        plan. Billing flows ship Phase 6c — today it&apos;s sign-up and Free tier only.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              'flex flex-col rounded-xl border bg-white p-6 shadow-sm',
              plan.highlight ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-ink-100',
            )}
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              {plan.name}
            </div>
            <div className="mt-2 text-2xl font-semibold">{plan.priceINR}</div>
            <div className="text-sm text-ink-500">{plan.priceUSD}</div>
            <div className="mt-3 text-sm text-ink-700">{plan.headline}</div>
            <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-ink-700">
              {plan.features.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
            <Link
              href="/login"
              className={cn(
                'mt-6 rounded-md px-4 py-2 text-center text-sm font-medium transition',
                plan.highlight
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'border border-ink-100 text-ink-700 hover:bg-ink-50',
              )}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}
