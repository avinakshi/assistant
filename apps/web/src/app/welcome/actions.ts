'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Mark the current user as onboarded + send them to the dashboard. No-ops gracefully
 * if the update fails — the dashboard is still the intended destination.
 */
export async function completeOnboarding(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('profiles')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('user_id', user.id);
  }
  redirect('/app');
}
