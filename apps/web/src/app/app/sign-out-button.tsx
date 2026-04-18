'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push('/login');
      }}
      className="mt-2 rounded border border-ink-100 px-2 py-1 text-xs text-ink-500 hover:bg-ink-50"
    >
      Sign out
    </button>
  );
}
