import Link from 'next/link';

export default function BillingPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <div className="mt-6 rounded-xl border border-ink-100 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Current plan
        </div>
        <div className="mt-1 text-lg font-semibold">Free</div>
        <p className="mt-2 text-sm text-ink-700">
          10 minutes of live sessions and 1 practice run per week. Upgrade to Starter or Pro
          for more.
        </p>
        <Link
          href="/pricing"
          className="mt-4 inline-block rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          See plans
        </Link>
      </div>
      <div className="mt-6 rounded-xl border border-dashed border-ink-100 bg-white p-6 text-sm text-ink-500">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Phase 6c
        </div>
        Razorpay (India) + Stripe (international) checkout wire in next. Until then, nothing
        is charged.
      </div>
    </div>
  );
}
