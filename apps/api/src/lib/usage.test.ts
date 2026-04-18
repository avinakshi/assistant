import { describe, it, expect } from 'vitest';
import {
  PLAN_LIMITS,
  decideQuota,
  formatSeconds,
  type UsageSnapshot,
} from './usage';

const mk = (over: Partial<UsageSnapshot>): UsageSnapshot => ({
  plan: 'free',
  weeklyLimitSeconds: PLAN_LIMITS.free.weeklySeconds,
  usedSeconds: 0,
  remainingSeconds: PLAN_LIMITS.free.weeklySeconds,
  ...over,
});

describe('PLAN_LIMITS', () => {
  it('caps free at exactly 600s (10 min)', () => {
    expect(PLAN_LIMITS.free.weeklySeconds).toBe(600);
  });
  it('caps starter at 36000s (10 h)', () => {
    expect(PLAN_LIMITS.starter.weeklySeconds).toBe(36_000);
  });
  it('leaves pro + lifetime unlimited', () => {
    expect(PLAN_LIMITS.pro.weeklySeconds).toBeNull();
    expect(PLAN_LIMITS.lifetime.weeklySeconds).toBeNull();
  });
});

describe('decideQuota', () => {
  it('allows a fresh free user with zero usage', () => {
    expect(decideQuota(mk({ usedSeconds: 0 })).allowed).toBe(true);
  });

  it('allows a free user just shy of the cap', () => {
    expect(decideQuota(mk({ usedSeconds: 599 })).allowed).toBe(true);
  });

  it('denies a free user at the cap', () => {
    const r = decideQuota(mk({ usedSeconds: 600 }));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('weekly-exceeded');
  });

  it('denies a free user over the cap', () => {
    const r = decideQuota(mk({ usedSeconds: 700 }));
    expect(r.allowed).toBe(false);
  });

  it('allows unlimited plans regardless of usage', () => {
    expect(
      decideQuota(
        mk({
          plan: 'pro',
          weeklyLimitSeconds: null,
          remainingSeconds: null,
          usedSeconds: 10 ** 9,
        }),
      ).allowed,
    ).toBe(true);
  });
});

describe('formatSeconds', () => {
  it('renders seconds-only when under a minute', () => {
    expect(formatSeconds(45)).toBe('45s');
  });
  it('rounds to whole seconds', () => {
    expect(formatSeconds(45.7)).toBe('46s');
  });
  it('drops the seconds suffix when a round number of minutes', () => {
    expect(formatSeconds(600)).toBe('10 min');
  });
  it('combines minutes and seconds when both non-zero', () => {
    expect(formatSeconds(125)).toBe('2 min 5s');
  });
  it('guards against negative input', () => {
    expect(formatSeconds(-1)).toBe('0s');
  });
});
