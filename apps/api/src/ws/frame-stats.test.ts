import { describe, expect, it } from 'vitest';
import { AUDIO_BYTES_PER_FRAME, AUDIO_FRAMES_PER_SECOND } from '@repo/shared';
import { FrameStatsWindow } from './frame-stats';

function silentFrame(): Uint8Array {
  return new Uint8Array(AUDIO_BYTES_PER_FRAME);
}

function fullScaleFrame(): Uint8Array {
  const samples = new Int16Array(AUDIO_BYTES_PER_FRAME / 2).fill(32767);
  return new Uint8Array(samples.buffer);
}

describe('FrameStatsWindow.ingest', () => {
  it('accepts a valid 640-byte PCM frame', () => {
    const w = new FrameStatsWindow();
    expect(w.ingest(silentFrame())).toEqual({ accepted: true });
  });

  it('rejects wrong-sized frames', () => {
    const w = new FrameStatsWindow();
    const r = w.ingest(new Uint8Array(AUDIO_BYTES_PER_FRAME - 1));
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/expected 640/);
  });

  it('handles misaligned buffer byteOffset without throwing', () => {
    const backing = new Uint8Array(AUDIO_BYTES_PER_FRAME + 1);
    const misaligned = backing.subarray(1); // byteOffset = 1 (odd)
    const w = new FrameStatsWindow();
    expect(w.ingest(misaligned)).toEqual({ accepted: true });
  });
});

describe('FrameStatsWindow.snapshot', () => {
  it('reports ~50 fps when 50 frames ingested over 1 second', () => {
    const start = 1_700_000_000_000;
    const w = new FrameStatsWindow(1000, start);
    for (let i = 0; i < AUDIO_FRAMES_PER_SECOND; i++) w.ingest(silentFrame());
    const snap = w.snapshot(start + 1000);
    expect(snap.framesReceived).toBe(50);
    expect(snap.framesPerSecond).toBeGreaterThan(49);
    expect(snap.framesPerSecond).toBeLessThan(51);
    expect(snap.windowMs).toBe(1000);
  });

  it('reports clamped -120 dB for silent input (instead of -Infinity over wire)', () => {
    const w = new FrameStatsWindow();
    w.ingest(silentFrame());
    const snap = w.snapshot();
    expect(snap.rmsDb).toBe(-120);
  });

  it('reports ~0 dBFS for full-scale input', () => {
    const w = new FrameStatsWindow();
    w.ingest(fullScaleFrame());
    const snap = w.snapshot();
    expect(snap.rmsDb).toBeGreaterThan(-0.5);
    expect(snap.rmsDb).toBeLessThanOrEqual(0);
  });
});

describe('FrameStatsWindow.rollover', () => {
  it('resets frames and samples but preserves totalFrames', () => {
    const start = 1_700_000_000_000;
    const w = new FrameStatsWindow(1000, start);
    for (let i = 0; i < 10; i++) w.ingest(silentFrame());
    w.rollover(start + 1000);
    const snap = w.snapshot(start + 1050);
    expect(snap.framesReceived).toBe(10); // cumulative total is preserved
    expect(snap.framesPerSecond).toBe(0); // window is fresh
    expect(snap.windowMs).toBe(50);
  });
});
