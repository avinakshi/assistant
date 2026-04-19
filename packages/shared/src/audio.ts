/**
 * PCM audio wire contract — shared between Rust audio-core, Electron main, and api.
 *
 * Reference: docs/INTERVIEW-COPILOT-COMPLETE.txt §04 ARCHITECTURE.md Part 2 ("PCM frame contract").
 * 16 kHz mono linear16 PCM, 320 samples per frame = 640 bytes, 20 ms = 50 fps.
 */

export const AUDIO_SAMPLE_RATE_HZ = 16_000 as const;
export const AUDIO_CHANNELS = 1 as const;
export const AUDIO_BYTES_PER_SAMPLE = 2 as const;
export const AUDIO_SAMPLES_PER_FRAME = 320 as const;
export const AUDIO_BYTES_PER_FRAME =
  AUDIO_SAMPLES_PER_FRAME * AUDIO_BYTES_PER_SAMPLE * AUDIO_CHANNELS;
export const AUDIO_FRAMES_PER_SECOND = AUDIO_SAMPLE_RATE_HZ / AUDIO_SAMPLES_PER_FRAME;
export const AUDIO_FRAME_DURATION_MS =
  (AUDIO_SAMPLES_PER_FRAME / AUDIO_SAMPLE_RATE_HZ) * 1000;

/**
 * Diarization-mode frame layout (opt-in via `session.start {diarize:true}`). The first
 * byte tags the source (0 = interviewer / remote audio, 1 = candidate / local mic); the
 * remaining AUDIO_BYTES_PER_FRAME bytes are the normal PCM16 payload. Total = 641 bytes.
 * Cheap (~0.15% overhead at 16 kHz) and lets one WS carry both sources in-order.
 */
export const AUDIO_SOURCE_TAG_BYTES = 1 as const;
export const AUDIO_BYTES_PER_FRAME_DIARIZED = AUDIO_BYTES_PER_FRAME + AUDIO_SOURCE_TAG_BYTES;
export const AUDIO_SOURCE_INTERVIEWER = 0 as const;
export const AUDIO_SOURCE_CANDIDATE = 1 as const;
export type AudioSource = 'interviewer' | 'candidate';

export function encodeAudioSourceTag(source: AudioSource): number {
  return source === 'candidate' ? AUDIO_SOURCE_CANDIDATE : AUDIO_SOURCE_INTERVIEWER;
}

export function decodeAudioSourceTag(tag: number): AudioSource {
  return tag === AUDIO_SOURCE_CANDIDATE ? 'candidate' : 'interviewer';
}

export interface PcmFrame {
  readonly samples: Int16Array;
  readonly timestampNs: bigint;
}

export function isValidPcmFrame(buffer: ArrayBufferView): boolean {
  return buffer.byteLength === AUDIO_BYTES_PER_FRAME;
}

/**
 * Root-mean-square of a signed-16 PCM buffer, expressed in dBFS (decibels relative to full scale).
 * Used for frame-rate / energy telemetry — never for signal processing decisions.
 */
export function computeRmsDb(samples: Int16Array): number {
  if (samples.length === 0) return -Infinity;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sumSquares += s * s;
  }
  const mean = sumSquares / samples.length;
  const rms = Math.sqrt(mean);
  if (rms === 0) return -Infinity;
  // 32767 = max |Int16|. 20*log10(rms / full-scale).
  return 20 * Math.log10(rms / 32767);
}
