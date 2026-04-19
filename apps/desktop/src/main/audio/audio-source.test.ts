import { describe, expect, it } from 'vitest';
import {
  AUDIO_SAMPLES_PER_FRAME,
  AUDIO_SAMPLE_RATE_HZ,
  AUDIO_FRAME_DURATION_MS,
  computeRmsDb,
} from '@repo/shared';
import { NativeAudioSource, StubSineAudioSource } from './audio-source';

describe('StubSineAudioSource', () => {
  it('emits 320-sample Int16 frames with monotonically increasing timestamps', async () => {
    const source = new StubSineAudioSource();
    const frames: { samples: Int16Array; ts: bigint }[] = [];
    source.onFrame((s, t) => frames.push({ samples: s, ts: t }));

    await source.start();
    // Wait ~12 frames (240 ms @ 50 fps). Windows setTimeout jitter occasionally lets a
    // 6-frame wait land with only 2 frames delivered, flaking the assertion below. 12 is
    // enough headroom that even a 15ms timer slip still produces ≥ 5 frames.
    await new Promise((r) => setTimeout(r, AUDIO_FRAME_DURATION_MS * 12));
    await source.stop();

    expect(frames.length).toBeGreaterThanOrEqual(5);
    for (const f of frames) expect(f.samples.length).toBe(AUDIO_SAMPLES_PER_FRAME);

    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1]!;
      const cur = frames[i]!;
      expect(cur.ts).toBeGreaterThan(prev.ts);
    }
  });

  it('produces a sine at the requested frequency (RMS near -3 dBFS for amplitude=32767)', async () => {
    const source = new StubSineAudioSource(1000, 32767);
    const collected: Int16Array[] = [];
    source.onFrame((s) => collected.push(new Int16Array(s)));

    await source.start();
    await new Promise((r) => setTimeout(r, AUDIO_FRAME_DURATION_MS * 10));
    await source.stop();

    expect(collected.length).toBeGreaterThan(3);
    // Sine RMS = amplitude / sqrt(2) → -3.01 dBFS.
    const last = collected[collected.length - 1]!;
    const rms = computeRmsDb(last);
    expect(rms).toBeGreaterThan(-3.5);
    expect(rms).toBeLessThan(-2.5);
  });

  it('start() is idempotent', async () => {
    const source = new StubSineAudioSource();
    await source.start();
    await source.start(); // no-op
    await source.stop();
  });
});

describe('NativeAudioSource', () => {
  // We can't unit-test the real WASAPI pathway in CI without audio hardware — covered by
  // the manual smoke matrix in docs/TESTING.md Phase 1. Smoke: instantiation doesn't throw.
  it('instantiates without calling start()', () => {
    const source = new NativeAudioSource();
    expect(source).toBeDefined();
  });
});

describe('sample-rate invariants', () => {
  // Sanity check the arithmetic the stub depends on — if @repo/shared constants drift,
  // we want this test to go red.
  it('yields 50 fps at 16 kHz / 320 samples', () => {
    expect(AUDIO_SAMPLE_RATE_HZ / AUDIO_SAMPLES_PER_FRAME).toBe(50);
  });
});
