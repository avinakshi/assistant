/**
 * Browser-side voice client for Phase 8b practice mode.
 *
 *   getUserMedia → AudioContext resampler → 16kHz PCM16 → WebSocket → api /ws/practice-stt
 *
 * We intentionally use `ScriptProcessorNode` rather than `AudioWorklet`. Worklets require
 * a separately served JS file, which complicates the Next.js build pipeline. For a
 * one-off speech-to-text downlink where glitch-free output isn't required (we're not
 * playing audio back), ScriptProcessorNode is fine. Upgrade path noted inline.
 *
 * Events the caller can subscribe to:
 *   - `ready`          — STT is open; safe to speak
 *   - `partial`        — interim transcript (replace previous)
 *   - `final`          — committed transcript (append)
 *   - `error`          — terminal; client is now closed
 *   - `closed`         — normal end
 */

export type VoiceEvent =
  | { kind: 'ready' }
  | { kind: 'partial'; text: string; ts: number }
  | { kind: 'final'; text: string; ts: number }
  | { kind: 'error'; message: string }
  | { kind: 'closed' };

export interface VoiceClientOptions {
  /** Full WS URL to /ws/practice-stt, including `?token=<jwt>`. */
  readonly url: string;
  /** Listener. Called for every event; caller should dispatch on `kind`. */
  readonly onEvent: (ev: VoiceEvent) => void;
}

// 20ms @ 16kHz mono PCM16 = 320 samples = 640 bytes. Matches AUDIO_BYTES_PER_FRAME on the
// api side — kept as a literal here so this module has no @repo/shared dependency (runs
// in a client component, build-cost sensitive).
const TARGET_SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 320;
const FRAME_BYTES = FRAME_SAMPLES * 2;

export class VoiceClient {
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private pendingSamples: Int16Array[] = [];
  private pendingSampleCount = 0;
  private closed = false;

  constructor(private readonly opts: VoiceClientOptions) {}

  async start(): Promise<void> {
    if (this.closed) throw new Error('VoiceClient already closed');

    // 1. Mic permission + stream. The browser picks an input sample rate (usually 44.1k
    // or 48k); we downsample in software.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    this.mediaStream = stream;

    const audioCtx = new AudioContext();
    this.audioCtx = audioCtx;
    const inputSampleRate = audioCtx.sampleRate;
    const ratio = inputSampleRate / TARGET_SAMPLE_RATE;

    this.source = audioCtx.createMediaStreamSource(stream);
    // Buffer size 4096 is a sane balance — smaller sizes blow up main-thread traffic;
    // larger adds latency. 4096 @ 48kHz ≈ 85ms per callback, ~12 Hz.
    this.processor = audioCtx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (ev: AudioProcessingEvent): void => {
      if (this.closed) return;
      const input = ev.inputBuffer.getChannelData(0);
      const downsampled = downsampleAndPack(input, ratio);
      this.pushSamples(downsampled);
    };

    this.source.connect(this.processor);
    this.processor.connect(audioCtx.destination);

    // 2. Open the WS. Attach listeners before declaring success so we don't miss a
    // fast-arriving `ready` or `error`.
    await this.openWs();
  }

  private openWs(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = (): void => {
        if (!opened) reject(new Error('WebSocket failed to open'));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          // Our own /ws/practice-stt WS stream. Each branch type-narrows the fields
          // it actually reads; a full Zod parse here would slow the partial-transcript
          // hot path without changing outcomes.
          // eslint-disable-next-line no-restricted-syntax
          const parsed = JSON.parse(ev.data) as { type?: string } & Record<string, unknown>;
          if (parsed.type === 'ready') this.opts.onEvent({ kind: 'ready' });
          else if (parsed.type === 'partial')
            this.opts.onEvent({
              kind: 'partial',
              text: (parsed['text'] as string) ?? '',
              ts: (parsed['ts'] as number) ?? Date.now(),
            });
          else if (parsed.type === 'final')
            this.opts.onEvent({
              kind: 'final',
              text: (parsed['text'] as string) ?? '',
              ts: (parsed['ts'] as number) ?? Date.now(),
            });
          else if (parsed.type === 'error')
            this.opts.onEvent({
              kind: 'error',
              message: (parsed['message'] as string) ?? 'unknown error',
            });
        } catch {
          // ignore malformed server frames
        }
      };
      ws.onclose = () => {
        this.opts.onEvent({ kind: 'closed' });
        void this.stop();
      };
    });
  }

  private pushSamples(samples: Int16Array): void {
    this.pendingSamples.push(samples);
    this.pendingSampleCount += samples.length;
    while (this.pendingSampleCount >= FRAME_SAMPLES) {
      const frame = this.drainFrame();
      if (!frame) break;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
      }
    }
  }

  private drainFrame(): Int16Array | null {
    if (this.pendingSampleCount < FRAME_SAMPLES) return null;
    const out = new Int16Array(FRAME_SAMPLES);
    let written = 0;
    while (written < FRAME_SAMPLES && this.pendingSamples.length > 0) {
      const head = this.pendingSamples[0]!;
      const need = FRAME_SAMPLES - written;
      if (head.length <= need) {
        out.set(head, written);
        written += head.length;
        this.pendingSamples.shift();
      } else {
        out.set(head.subarray(0, need), written);
        written += need;
        this.pendingSamples[0] = head.subarray(need);
      }
    }
    this.pendingSampleCount -= FRAME_SAMPLES;
    return out;
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Drain: send a `stop` message so the server closes Deepgram cleanly.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'stop' }));
      } catch {
        /* ignore */
      }
      try {
        this.ws.close(1000, 'client-stop');
      } catch {
        /* ignore */
      }
    }
    this.ws = null;

    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        /* ignore */
      }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        /* ignore */
      }
      this.audioCtx = null;
    }
    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) t.stop();
      this.mediaStream = null;
    }
  }
}

/**
 * Downsample a Float32Array of raw mic samples to 16kHz, convert to Int16 PCM.
 *
 * Ratio is `inputSampleRate / 16000`. Uses nearest-neighbor picking — fine for speech.
 * A sinc / linear interpolation upgrade is cheap if voice quality tests flag artifacts.
 *
 * Exported so unit tests can exercise it independently of the audio stack.
 */
export function downsampleAndPack(input: Float32Array, ratio: number): Int16Array {
  if (!(ratio > 0)) return new Int16Array(0);
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  let readIdx = 0;
  for (let i = 0; i < outLen; i++) {
    const sample = input[Math.floor(readIdx)] ?? 0;
    // Clamp to [-1, 1] and convert to 16-bit signed.
    const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
    out[i] = (clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF) | 0;
    readIdx += ratio;
  }
  return out;
}

/**
 * Given an origin like "http://localhost:3001" return the matching WS origin.
 * Used to derive the api WS URL from NEXT_PUBLIC_API_BASE_URL when the explicit
 * NEXT_PUBLIC_API_WS_URL is unset. Exported for tests.
 */
export function httpOriginToWs(origin: string): string {
  if (origin.startsWith('https://')) return 'wss://' + origin.slice('https://'.length);
  if (origin.startsWith('http://')) return 'ws://' + origin.slice('http://'.length);
  return origin; // assume already ws[s]://
}

/** Frame size constants for consumers that want them without repeating magic numbers. */
export const VOICE_FRAME = {
  SAMPLE_RATE: TARGET_SAMPLE_RATE,
  SAMPLES: FRAME_SAMPLES,
  BYTES: FRAME_BYTES,
} as const;

// ---- Browser TTS (interviewer voice-out) ----------------------------------
// Simple wrapper around SpeechSynthesis so callers don't need to poke globals directly.

export function speakQuestion(text: string, opts?: { rate?: number; pitch?: number }): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = opts?.rate ?? 1;
  utter.pitch = opts?.pitch ?? 1;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}
