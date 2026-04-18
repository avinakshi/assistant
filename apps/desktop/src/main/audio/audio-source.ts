/**
 * AudioSource — interface the desktop main process consumes to receive PCM frames.
 * Implemented two ways:
 *   - NativeAudioSource (wraps @repo/audio-core, lands once Rust toolchain is installed)
 *   - StubSineAudioSource (deterministic 440 Hz sine wave, used for dev + CI without native build)
 *
 * Contract: emits 50 fps of 320-sample Int16 PCM mono at 16 kHz — see @repo/shared/audio.
 */
import { AUDIO_SAMPLES_PER_FRAME, AUDIO_SAMPLE_RATE_HZ, AUDIO_FRAME_DURATION_MS } from '@repo/shared';

export interface AudioSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFrame(listener: (frame: Int16Array, timestampNs: bigint) => void): void;
  onError(listener: (code: string, message: string) => void): void;
}

export type AudioSourceKind = 'native' | 'stub';

/**
 * Deterministic synthetic source. Useful for:
 *   - verifying main→ws→api wiring without the Rust addon
 *   - CI integration tests (reproducible RMS / fps)
 *   - demos on a Mac/Linux dev box before WASAPI loopback is wired
 */
export class StubSineAudioSource implements AudioSource {
  private timer: NodeJS.Timeout | null = null;
  private phase = 0;
  private startNs = 0n;
  private frameIndex = 0;
  private frameListeners: ((frame: Int16Array, ts: bigint) => void)[] = [];
  private errorListeners: ((code: string, message: string) => void)[] = [];

  constructor(
    private readonly freqHz = 440,
    private readonly amplitude = 8000,
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.startNs = BigInt(Date.now()) * 1_000_000n;
    this.frameIndex = 0;
    this.timer = setInterval(() => this.emit(), AUDIO_FRAME_DURATION_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onFrame(listener: (frame: Int16Array, ts: bigint) => void): void {
    this.frameListeners.push(listener);
  }

  onError(listener: (code: string, message: string) => void): void {
    this.errorListeners.push(listener);
  }

  private emit(): void {
    const samples = new Int16Array(AUDIO_SAMPLES_PER_FRAME);
    const step = (2 * Math.PI * this.freqHz) / AUDIO_SAMPLE_RATE_HZ;
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.round(this.amplitude * Math.sin(this.phase));
      this.phase += step;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    }
    const ts =
      this.startNs +
      BigInt(this.frameIndex) *
        BigInt(Math.round((AUDIO_SAMPLES_PER_FRAME * 1e9) / AUDIO_SAMPLE_RATE_HZ));
    this.frameIndex += 1;
    for (const l of this.frameListeners) l(samples, ts);
  }
}

/**
 * Real system-audio source backed by the Rust napi-rs addon (`@repo/audio-core`).
 * On Windows: WASAPI loopback. On Mac: ScreenCaptureKit (deferred — see macos.rs).
 *
 * The Rust side delivers frames as `Array<number>` (a napi Buffer-like) of length 640.
 * We reinterpret as Int16Array and synthesize timestamps from a monotonic counter —
 * the Rust side also tags timestamps, but the napi contract for this build exposes only
 * the bytes; Phase 2 will extend to include nanosecond timestamps in the callback signature.
 */
export class NativeAudioSource implements AudioSource {
  private session: { start: () => void; stop: () => void } | null = null;
  private frameListeners: ((frame: Int16Array, ts: bigint) => void)[] = [];
  private errorListeners: ((code: string, message: string) => void)[] = [];
  private startNs = 0n;
  private frameIndex = 0;

  async start(): Promise<void> {
    if (this.session) return;
    // Require here rather than ESM-import so the optional native dep stays optional:
    // during Vitest runs without the addon built, `stub` works and this is never reached.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const addon = (await import('@repo/audio-core')) as unknown as {
      AudioSession: new (
        onFrame: (err: Error | null, bytes: Buffer | number[]) => void,
        onError?: (err: Error | null, code: string, message: string) => void,
      ) => { start: () => void; stop: () => void };
    };

    this.startNs = BigInt(Date.now()) * 1_000_000n;
    this.frameIndex = 0;

    const session = new addon.AudioSession(
      (err, bytes) => {
        if (err) {
          for (const l of this.errorListeners) l('DISPATCH', err.message);
          return;
        }
        const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        if (buf.byteLength !== AUDIO_SAMPLES_PER_FRAME * 2) return;
        const samples = new Int16Array(
          buf.buffer,
          buf.byteOffset,
          buf.byteLength / 2,
        );
        const ts =
          this.startNs +
          BigInt(this.frameIndex) *
            BigInt(Math.round((AUDIO_SAMPLES_PER_FRAME * 1e9) / AUDIO_SAMPLE_RATE_HZ));
        this.frameIndex += 1;
        // Copy — the underlying buffer may be reused by napi between callbacks.
        const copy = new Int16Array(samples);
        for (const l of this.frameListeners) l(copy, ts);
      },
      (err, code, message) => {
        if (err) return;
        for (const l of this.errorListeners) l(code, message);
      },
    );
    session.start();
    this.session = session;
  }

  async stop(): Promise<void> {
    if (this.session) {
      this.session.stop();
      this.session = null;
    }
  }

  onFrame(listener: (frame: Int16Array, ts: bigint) => void): void {
    this.frameListeners.push(listener);
  }

  onError(listener: (code: string, message: string) => void): void {
    this.errorListeners.push(listener);
  }
}

export function createAudioSource(kind: AudioSourceKind): AudioSource {
  return kind === 'stub' ? new StubSineAudioSource() : new NativeAudioSource();
}
