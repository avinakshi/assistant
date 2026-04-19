import { createClient } from '@/lib/supabase/server';
import { PersistTranscriptsToggle } from './persist-toggle';
import { CopyTokenCard } from './copy-token-card';
import { ApiKeysCard } from './api-keys-card';
import { DeleteAccountCard } from './delete-account-card';

export const dynamic = 'force-dynamic';

interface ProfileRow {
  persist_transcripts_default?: boolean;
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const [{ data: profile }, { data: userData }] = await Promise.all([
    supabase.from('profiles').select('persist_transcripts_default').maybeSingle(),
    supabase.auth.getUser(),
  ]);

  // Default to TRUE when the row is missing or the column hasn't been backfilled yet —
  // keeps parity with the desktop's hardcoded behavior.
  const persistDefault = (profile as ProfileRow | null)?.persist_transcripts_default ?? true;
  const email = userData.user?.email ?? '';

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-ink-500">
        Preferences saved to your profile.
      </p>

      <section className="mt-6 flex flex-col gap-4">
        <PersistTranscriptsToggle initial={persistDefault} />
        <CopyTokenCard />
        <ApiKeysCard />
      </section>

      {email && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
            Danger zone
          </h2>
          <div className="mt-3">
            <DeleteAccountCard email={email} />
          </div>
        </section>
      )}
    </div>
  );
}
