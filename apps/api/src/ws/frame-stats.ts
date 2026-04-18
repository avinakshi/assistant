import {
  AUDIO_BYTES_PER_FRAME,
  AUDIO_FRAMES_PER_SECOND,
  computeRmsDb,
} from '@repo/shared';

/**
 * Accumulates PCM frame telemetry over a rolling 1-second window and emits snapshots.
 * Pure — no I/O, no timers. Callers decide when to drive tick() and consume the snapshot.
 */
export interface FrameStatsSnapshot {
  framesReceived: number;
  framesPerSecond: number;
  rmsDb: number;
  windowMs: number;
}

export class FrameStatsWindow {
  private frames = 0;
  private totalFrames = 0;
  private sumSquares = 0;
  private sampleCount = 0;
  private windowStartMs: number;

  // windowMs is a hint for callers — this class doesn't tick internally.
  // snapshot() reports the measured window (nowMs - windowStartMs).
  constructor(_windowMs = 1000, nowMs = Date.now()) {
    this.windowStartMs = nowMs;
  }

  ingest(frame: Uint8Array): { accepted: boolean; reason?: string } {
    if (frame.byteLength !== AUDIO_BYTES_PER_FRAME) {
      return { accepted: false, reason: `expected ${AUDIO_BYTES_PER_FRAME} bytes, got ${frame.byteLength}` };
    }
    // Reinterpret as Int16Array. Buffer may not be 2-byte aligned, so copy if needed.
    const samples = alignedInt16View(frame);
    let localSum = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i] ?? 0;
      localSum += s * s;
    }
    this.sumSquares += localSum;
    this.sampleCount += samples.length;
    this.frames += 1;
    this.totalFrames += 1;
    return { accepted: true };
  }

  snapshot(nowMs = Date.now()): FrameStatsSnapshot {
    const elapsed = Math.max(1, nowMs - this.windowStartMs);
    const fps = (this.frames * 1000) / elapsed;
    const rmsDb =
      this.sampleCount === 0
        ? -Infinity
        : computeRmsDb(synthesizeRmsInt16(this.sumSquares, this.sampleCount));
    return {
      framesReceived: this.totalFrames,
      framesPerSecond: Number(fps.toFixed(2)),
      rmsDb: Number.isFinite(rmsDb) ? Number(rmsDb.toFixed(2)) : -120,
      windowMs: elapsed,
    };
  }

  rollover(nowMs = Date.now()): void {
    this.frames = 0;
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.windowStartMs = nowMs;
  }

  get expectedFps(): number {
    return AUDIO_FRAMES_PER_SECOND;
  }
}

function alignedInt16View(frame: Uint8Array): Int16Array {
  // Node Buffers are sometimes views into a shared ArrayBuffer with arbitrary byte offsets.
  // Int16Array requires 2-byte alignment — copy if misaligned.
  if (frame.byteOffset % 2 === 0) {
    return new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2);
  }
  const copy = new Uint8Array(frame);
  return new Int16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2);
}

/**
 * computeRmsDb operates on an Int16Array. We hold running sum-of-squares across frames,
 * so we synthesize a one-sample buffer whose square matches the running mean. Preserves the
 * single dBFS code path in @repo/shared.
 */
function synthesizeRmsInt16(sumSquares: number, sampleCount: number): Int16Array {
  const mean = sumSquares / sampleCount;
  const rms = Math.sqrt(mean);
  const clamped = Math.min(32767, Math.max(-32768, Math.round(rms)));
  return new Int16Array([clamped]);
}
