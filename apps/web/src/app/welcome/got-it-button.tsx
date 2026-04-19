'use client';

import { useTransition } from 'react';
import { completeOnboarding } from './actions';

/**
 * Client-side submit button for the onboarding dismissal. Calls the server action
 * imperatively so we don't have to rely on React 19's "server action as form action"
 * typing, which this TypeScript version doesn't know about yet.
 */
export function GotItButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          void completeOnboarding();
        });
      }}
      className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      {pending ? 'Saving\u2026' : 'Got it \u2014 take me to the dashboard'}
    </button>
  );
}
