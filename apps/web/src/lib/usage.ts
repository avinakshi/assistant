/**
 * Web-side usage helpers. Mirrors apps/api/src/lib/usage.ts but reads from Supabase
 * via the user's scoped client (RLS keeps us to their own rows).
 *
 * Shared shape with the api: same plan names, same limits, same rolling window. Keeping
 * the numbers in sync manually is fine today — there's only one source of truth for
 * plan limits that matters (the api's authorisation gate). The web copy here is a
 * UI-only display; if it drifts from reality the user just sees a slightly wrong number.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Plan = 'free' | 'starter' | 'pro' | 'lifetime';

export const PLAN_LIMITS: Record<Plan, { weeklySeconds: number | null }> = {
  free: { weeklySeconds: 10 * 60 },
  starter: { weeklySeconds: 10 * 60 * 60 },
  pro: { weeklySeconds: null },
  lifetime: { weeklySeconds: null },
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const VALID_PLANS = new Set<Plan>(['free', 'starter', 'pro', 'lifetime']);

export interface UsageSnapshot {
  readonly plan: Plan;
  readonly weeklyLimitSeconds: number | null;
  readonly usedSeconds: number;
  readonly remainingSeconds: number | null;
}

export async function readUsageSnapshot(supabase: SupabaseClient): Promise<UsageSnapshot> {
  // Both queries are scoped to auth.uid() by RLS so we don't need to pass the user id.
  const [{ data: profile }, { data: sessions }] = await Promise.all([
    supabase.from('profiles').select('plan').maybeSingle(),
    supabase
      .from('sessions')
      .select('duration_s')
      .gte('started_at', new Date(Date.now() - WEEK_MS).toISOString())
      .not('duration_s', 'is', null),
  ]);

  const rawPlan = (profile as { plan?: unknown } | null)?.plan;
  const plan: Plan = typeof rawPlan === 'string' && VALID_PLANS.has(rawPlan as Plan)
    ? (rawPlan as Plan)
    : 'free';

  let usedSeconds = 0;
  for (const row of (sessions as Array<{ duration_s: number | null }> | null) ?? []) {
    if (typeof row.duration_s === 'number') usedSeconds += row.duration_s;
  }

  const limit = PLAN_LIMITS[plan].weeklySeconds;
  return {
    plan,
    weeklyLimitSeconds: limit,
    usedSeconds,
    remainingSeconds: limit === null ? null : Math.max(0, limit - usedSeconds),
  };
}

export function formatMinutes(seconds: number): string {
  const m = seconds / 60;
  if (m < 1) return `${Math.round(seconds)}s`;
  if (m < 10) return `${m.toFixed(1)} min`;
  return `${Math.round(m)} min`;
}

export function planDisplayName(plan: Plan): string {
  switch (plan) {
    case 'free':
      return 'Free';
    case 'starter':
      return 'Starter';
    case 'pro':
      return 'Pro';
    case 'lifetime':
      return 'Lifetime';
  }
}
