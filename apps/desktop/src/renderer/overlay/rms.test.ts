import { describe, expect, it } from 'vitest';
import { rmsDbToBarLevel, RMS_CEILING_DB, RMS_FLOOR_DB } from './rms';

describe('rmsDbToBarLevel', () => {
  it('returns 0 at or below the floor', () => {
    expect(rmsDbToBarLevel(RMS_FLOOR_DB)).toBe(0);
    expect(rmsDbToBarLevel(-120)).toBe(0);
    expect(rmsDbToBarLevel(-Infinity)).toBe(0);
  });

  it('returns 1 at or above the ceiling', () => {
    expect(rmsDbToBarLevel(RMS_CEILING_DB)).toBe(1);
    expect(rmsDbToBarLevel(5)).toBe(1);
  });

  it('interpolates linearly', () => {
    const mid = (RMS_FLOOR_DB + RMS_CEILING_DB) / 2;
    expect(rmsDbToBarLevel(mid)).toBeCloseTo(0.5, 5);
  });

  it('handles NaN gracefully', () => {
    expect(rmsDbToBarLevel(Number.NaN)).toBe(0);
  });
});
