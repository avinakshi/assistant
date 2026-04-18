/**
 * Usage meter + plan gating for live sessions.
 *
 * Free-tier users get 10 live minutes per rolling 7 days. Starter gets 10 hours / week.
 * Pro and Lifetime are unlimited. The numbers come from the Phase 6 spec and are a
 * deliberate "generous enough to feel free, tight enough to force conversion" calibration.
 *
 * Billing webhooks (Phase 6c Razorpay / 6d Stripe) flip `profiles.plan` between the four
 * values. Until those webhooks land, every user stays on 'free' after sign-up thanks to
 * the column default.
 *
 * Numbers are expressed in SECONDS everywhere in this file — frontend formatting converts
 * to minutes. Weekly window is a rolling 7×24h, NOT a calendar week, so quota lands
 * predictably instead of resetting at midnight Sunday.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Plan = 'free' | 'starter' | 'pro' | 'lifetime';

/** `null` means unlimited — the api skips the ceiling check entirely. */
export interface PlanLimits {
  readonly weeklySeconds: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { weeklySeconds: 10 * 60 }, // 10 minutes
  starter: { weeklySeconds: 10 * 60 * 60 }, // 10 hours
  pro: { weeklySeconds: null },
  lifetime: { weeklySeconds: null },
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const VALID_PLANS: ReadonlySet<string> = new Set<Plan>(['free', 'starter', 'pro', 'lifetime']);

export interface UsageSnapshot {
  readonly plan: Plan;
  readonly weeklyLimitSeconds: number | null;
  readonly usedSeconds: number;
  /** `null` when weeklyLimitSeconds is null (unlimited). */
  readonly remainingSeconds: number | null;
}

export async function getUserPlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<Plan> {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    // Fail closed to free — the user can still use the app, just under the tightest quota.
    return 'free';
  }
  const raw = (data as { plan?: unknown } | null)?.plan;
  if (typeof raw === 'string' && VALID_PLANS.has(raw)) return raw as Plan;
  return 'free';
}

/**
 * Sum duration_s over the last rolling 7×24h window for this user. Only closed sessions
 * (duration_s IS NOT NULL) count — an in-flight session is uncommitted until it ends.
 *
 * We query against the service-role client so RLS isn't a factor; the orchestrator already
 * knows whose userId it is, and this is strictly server-internal code.
 */
export async function getWeeklyUsedSeconds(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const windowStart = new Date(now.getTime() - WEEK_MS).toISOString();
  const { data, error } = await supabase
    .from('sessions')
    .select('duration_s')
    .eq('user_id', userId)
    .gte('started_at', windowStart)
    .not('duration_s', 'is', null);
  if (error || !data) return 0;
  let total = 0;
  for (const row of data as Array<{ duration_s: number | null }>) {
    if (typeof row.duration_s === 'number') total += row.duration_s;
  }
  return total;
}

export async function getUsageSnapshot(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<UsageSnapshot> {
  const [plan, used] = await Promise.all([
    getUserPlan(supabase, userId),
    getWeeklyUsedSeconds(supabase, userId, now),
  ]);
  const limit = PLAN_LIMITS[plan].weeklySeconds;
  return {
    plan,
    weeklyLimitSeconds: limit,
    usedSeconds: used,
    remainingSeconds: limit === null ? null : Math.max(0, limit - used),
  };
}

export type QuotaCheck =
  | { allowed: true; snapshot: UsageSnapshot }
  | { allowed: false; snapshot: UsageSnapshot; reason: 'weekly-exceeded' };

/**
 * Pure decision function. Separated from getUsageSnapshot so unit tests can feed in a
 * fixed snapshot without mocking Supabase.
 */
export function decideQuota(snapshot: UsageSnapshot): QuotaCheck {
  if (snapshot.weeklyLimitSeconds === null) return { allowed: true, snapshot };
  if (snapshot.usedSeconds >= snapshot.weeklyLimitSeconds) {
    return { allowed: false, snapshot, reason: 'weekly-exceeded' };
  }
  return { allowed: true, snapshot };
}

export async function checkQuota(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<QuotaCheck> {
  const snapshot = await getUsageSnapshot(supabase, userId, now);
  return decideQuota(snapshot);
}

/** Human-readable "X min Y s" for error messages + dashboards. */
export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  const min = Math.floor(s / 60);
  const rem = s % 60;
  if (min === 0) return `${rem}s`;
  if (rem === 0) return `${min} min`;
  return `${min} min ${rem}s`;
}
