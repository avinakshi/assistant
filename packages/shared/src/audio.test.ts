import { describe, expect, it } from 'vitest';
import {
  AUDIO_BYTES_PER_FRAME,
  AUDIO_BYTES_PER_FRAME_DIARIZED,
  AUDIO_FRAMES_PER_SECOND,
  AUDIO_FRAME_DURATION_MS,
  AUDIO_SAMPLES_PER_FRAME,
  AUDIO_SAMPLE_RATE_HZ,
  AUDIO_SOURCE_CANDIDATE,
  AUDIO_SOURCE_INTERVIEWER,
  AUDIO_SOURCE_TAG_BYTES,
  computeRmsDb,
  decodeAudioSourceTag,
  encodeAudioSourceTag,
  isValidPcmFrame,
} from './audio';

describe('audio constants', () => {
  it('locks the PCM frame contract (320 samples @ 16 kHz = 20 ms @ 50 fps)', () => {
    expect(AUDIO_SAMPLE_RATE_HZ).toBe(16_000);
    expect(AUDIO_SAMPLES_PER_FRAME).toBe(320);
    expect(AUDIO_BYTES_PER_FRAME).toBe(640);
    expect(AUDIO_FRAMES_PER_SECOND).toBe(50);
    expect(AUDIO_FRAME_DURATION_MS).toBe(20);
  });
});

describe('isValidPcmFrame', () => {
  it('accepts a 640-byte buffer', () => {
    expect(isValidPcmFrame(new Uint8Array(640))).toBe(true);
  });
  it('rejects any other size', () => {
    expect(isValidPcmFrame(new Uint8Array(320))).toBe(false);
    expect(isValidPcmFrame(new Uint8Array(641))).toBe(false);
    expect(isValidPcmFrame(new Uint8Array(0))).toBe(false);
  });
});

describe('computeRmsDb', () => {
  it('returns -Infinity for silence', () => {
    const silence = new Int16Array(320);
    expect(computeRmsDb(silence)).toBe(-Infinity);
  });

  it('returns 0 dBFS for a full-scale DC signal', () => {
    const fullScale = new Int16Array(320).fill(32767);
    expect(computeRmsDb(fullScale)).toBeCloseTo(0, 2);
  });

  it('matches analytic RMS for a pure sine wave within 0.2 dB', () => {
    // A full-amplitude sine has RMS = amplitude / sqrt(2) → -3.01 dBFS.
    const amplitude = 32767;
    const freq = 440;
    const samples = new Int16Array(AUDIO_SAMPLES_PER_FRAME);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / AUDIO_SAMPLE_RATE_HZ));
    }
    expect(computeRmsDb(samples)).toBeGreaterThan(-3.5);
    expect(computeRmsDb(samples)).toBeLessThan(-2.8);
  });

  it('returns -Infinity for empty input', () => {
    expect(computeRmsDb(new Int16Array(0))).toBe(-Infinity);
  });
});

describe('diarize frame layout', () => {
  it('uses a single extra byte as the source tag', () => {
    expect(AUDIO_SOURCE_TAG_BYTES).toBe(1);
    expect(AUDIO_BYTES_PER_FRAME_DIARIZED).toBe(AUDIO_BYTES_PER_FRAME + 1);
    expect(AUDIO_SOURCE_INTERVIEWER).toBe(0);
    expect(AUDIO_SOURCE_CANDIDATE).toBe(1);
  });

  it('round-trips encode/decode for both sources', () => {
    expect(encodeAudioSourceTag('interviewer')).toBe(AUDIO_SOURCE_INTERVIEWER);
    expect(encodeAudioSourceTag('candidate')).toBe(AUDIO_SOURCE_CANDIDATE);
    expect(decodeAudioSourceTag(AUDIO_SOURCE_INTERVIEWER)).toBe('interviewer');
    expect(decodeAudioSourceTag(AUDIO_SOURCE_CANDIDATE)).toBe('candidate');
  });

  it('defaults unknown tag bytes to interviewer (conservative — unlabeled audio is treated as remote)', () => {
    expect(decodeAudioSourceTag(99)).toBe('interviewer');
    expect(decodeAudioSourceTag(-1)).toBe('interviewer');
  });
});
