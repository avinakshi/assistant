import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata = { title: 'Log in — Interview Copilot' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-ink-100 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-ink-900">Log in</h1>
        <p className="mt-1 text-sm text-ink-500">
          We&apos;ll email you a one-time login link. No password to remember.
        </p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
