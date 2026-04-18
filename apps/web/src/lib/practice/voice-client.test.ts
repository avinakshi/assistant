import { describe, it, expect } from 'vitest';
import { downsampleAndPack, httpOriginToWs, VOICE_FRAME } from './voice-client';

describe('downsampleAndPack', () => {
  it('halves the sample count when ratio is 2 (48k → 24k stand-in)', () => {
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const out = downsampleAndPack(input, 2);
    expect(out.length).toBe(3);
  });

  it('converts float samples to 16-bit signed PCM at peaks', () => {
    // 1.0 → 0x7FFF, -1.0 → -0x8000
    const out = downsampleAndPack(new Float32Array([1.0, -1.0]), 1);
    expect(out[0]).toBe(0x7FFF);
    expect(out[1]).toBe(-0x8000);
  });

  it('clips out-of-range floats rather than wrapping', () => {
    const out = downsampleAndPack(new Float32Array([2.0, -2.0, 0.5]), 1);
    expect(out[0]).toBe(0x7FFF);
    expect(out[1]).toBe(-0x8000);
    expect(out[2]).toBe(0x3FFF); // 0.5 * 0x7FFF = 16383 = 0x3FFF (integer truncation)
  });

  it('returns empty output for a zero/negative ratio', () => {
    expect(downsampleAndPack(new Float32Array([1, 2, 3]), 0).length).toBe(0);
    expect(downsampleAndPack(new Float32Array([1, 2, 3]), -1).length).toBe(0);
  });

  it('maps silence to zeros', () => {
    const out = downsampleAndPack(new Float32Array(100), 2);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(0);
  });
});

describe('httpOriginToWs', () => {
  it('swaps http → ws', () => {
    expect(httpOriginToWs('http://localhost:3001')).toBe('ws://localhost:3001');
  });

  it('swaps https → wss', () => {
    expect(httpOriginToWs('https://api.example.com')).toBe('wss://api.example.com');
  });

  it('passes already-ws URLs through', () => {
    expect(httpOriginToWs('ws://localhost:3001')).toBe('ws://localhost:3001');
    expect(httpOriginToWs('wss://api.example.com')).toBe('wss://api.example.com');
  });
});

describe('VOICE_FRAME constants', () => {
  it('matches the api AUDIO_BYTES_PER_FRAME contract (640 bytes)', () => {
    expect(VOICE_FRAME.SAMPLE_RATE).toBe(16_000);
    expect(VOICE_FRAME.SAMPLES).toBe(320);
    expect(VOICE_FRAME.BYTES).toBe(640);
  });
});
