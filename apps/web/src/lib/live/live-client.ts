/**
 * Browser live-session client. Drives a full live interview flow entirely in the
 * browser — no desktop install needed. Captures interviewer audio via
 * getDisplayMedia (tab / window / screen share) and, optionally, the candidate's own
 * voice via getUserMedia.
 *
 * Both streams are downsampled to 16 kHz mono PCM16 and forwarded over the existing
 * /ws/session contract, so the orchestrator on the api side doesn't care whether the
 * caller is the desktop or a browser tab.
 *
 * Things this does that Parakeet's browser version doesn't:
 *   - Reuses the same display-media video track for "Analyze screen" without asking
 *     for a second screen-share permission (one stream, two uses).
 *   - Supports live mic capture in parallel so post-session transcripts can label
 *     speakers (diarization handled server-side in a later sub-phase).
 *   - Graceful token refresh using the extension's refresh_token flow (shared lib in
 *     11c ladder).
 */

import { downsampleAndPack } from '@/lib/practice/voice-client';

const SOURCE_TAG_INTERVIEWER = 0;
const SOURCE_TAG_CANDIDATE = 1;

/** ServerMessage shape sliced to what the live UI actually handles. */
export type LiveServerEvent =
  | { kind: 'ready'; sessionId: string; secondsAvailable: number }
  | { kind: 'transcript.partial'; text: string; source: 'interviewer' | 'candidate'; ts: number }
  | { kind: 'transcript.final'; text: string; source: 'interviewer' | 'candidate'; isQuestion: boolean; ts: number }
  | { kind: 'answer.start'; answerId: string; provider: string; mode?: string }
  | { kind: 'answer.delta'; answerId: string; text: string }
  | { kind: 'answer.done'; answerId: string; latencyMs: number; totalTokens: number }
  | { kind: 'answer.canceled'; answerId: string; reason: string }
  | { kind: 'ocr.result'; problemId: string; title?: string; site?: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'closed' };

export interface LiveClientOptions {
  readonly wsUrl: string;
  readonly token: string;
  readonly language?: string;
  readonly mode?: 'auto' | 'behavioral' | 'coding' | 'system_design';
  readonly llm?: 'auto' | 'claude' | 'gpt-5' | 'gpt-4.1' | 'gemini';
  readonly persistTranscripts?: boolean;
  readonly resumeId?: string;
  readonly jdId?: string;
  readonly personaId?: string;
  /** Free-form bias passed on session.start (max 2000 chars — enforced server-side). */
  readonly extraInstructions?: string;
  /** Phase 13f. When true, the LLM is pushed to CEFR A2-B1 English. */
  readonly simpleEnglish?: boolean;
  readonly onEvent: (ev: LiveServerEvent) => void;
}

/** ~20ms of 16kHz mono PCM16 = 320 samples = 640 bytes. Matches AUDIO_BYTES_PER_FRAME. */
const TARGET_SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 320;

export class LiveClient {
  private ws: WebSocket | null = null;
  private displayStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  /** Source → ScriptProcessor pairs, one per audio track we're capturing. */
  private processors: ScriptProcessorNode[] = [];
  private closed = false;
  /** Flipped to true only once the server emits session.ready; gates frame sending. */
  private sessionReady = false;

  constructor(private readonly opts: LiveClientOptions) {}

  /**
   * Kick off the full flow. Steps:
   *   1. Ask the user for display-media (they pick the meeting tab/window).
   *   2. Open the WS + fire session.start and WAIT for session.ready.
   *   3. Only then wire the audio track → we don't ship a single binary frame before
   *      the server has acknowledged the session, otherwise the server sees binary
   *      before session.start and silently drops every frame because state is still
   *      `awaiting-start`. (This was the Phase-13 "transcripts never work" bug.)
   * The mic stream comes later via `enableMic()` because the user should opt in.
   */
  async start(): Promise<void> {
    if (this.closed) throw new Error('LiveClient already closed');

    // Ask for a stream that includes audio — the browser's picker lets the user choose
    // a tab / window / screen. Video is requested too so we can sample frames for OCR
    // later without a second permission prompt.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        echoCancellation: false, // preserve interviewer's speech as-is
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: {
        // Small-ish so we don't waste CPU on video we only sample frames from.
        frameRate: 1,
      },
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new LiveClientError(
        'no-audio',
        'Your browser’s share dialog didn’t include audio. Re-share and enable "Share tab audio" (Chrome) or "Share with audio" (Edge).',
      );
    }
    this.displayStream = stream;

    const audioCtx = new AudioContext();
    this.audioCtx = audioCtx;
    const ratio = audioCtx.sampleRate / TARGET_SAMPLE_RATE;

    // Open WS + await `session.ready` BEFORE attaching the ScriptProcessor. The
    // processor starts firing onaudioprocess the instant we call proc.connect(), and
    // those events can race with / out-order the session.start text frame on slow
    // event loops, leaving the server in awaiting-start forever.
    console.info('[LiveClient] v13-fix: opening WS first, then wireTrack');
    await this.openWs();
    console.info('[LiveClient] v13-fix: WS open, session.start sent — wiring audio track');
    this.wireTrack(stream, ratio, 'interviewer');
  }

  /**
   * Mic-only start — skip getDisplayMedia entirely and transcribe just the candidate's
   * microphone. Useful when the interview is on a phone call or another device and the
   * candidate only wants their own voice captured. No video → Analyze-screen is disabled
   * in this mode; the live-shell hides that button.
   */
  async startMicOnly(): Promise<void> {
    if (this.closed) throw new Error('LiveClient already closed');

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.micStream = mic;

    const audioCtx = new AudioContext();
    this.audioCtx = audioCtx;
    const ratio = audioCtx.sampleRate / TARGET_SAMPLE_RATE;

    console.info('[LiveClient] mic-only: opening WS first');
    await this.openWs();
    console.info('[LiveClient] mic-only: WS open — wiring mic track as candidate');
    this.wireTrack(mic, ratio, 'candidate');
  }

  /** Open the mic and start forwarding that PCM too. Idempotent. */
  async enableMic(): Promise<void> {
    if (this.micStream || this.closed) return;
    if (!this.audioCtx) throw new LiveClientError('no-audio-ctx', 'start() must be called first');

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.micStream = mic;
    const ratio = this.audioCtx.sampleRate / TARGET_SAMPLE_RATE;
    this.wireTrack(mic, ratio, 'candidate');
  }

  /** Stop pushing mic audio + release the track. */
  async disableMic(): Promise<void> {
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop();
      this.micStream = null;
    }
    // The corresponding processor in `this.processors` is harmless once its source is
    // gone; it just stops firing audioprocess events. Leaving it registered avoids
    // book-keeping complexity.
  }

  /**
   * Capture a single frame from the display-media video track and ship it as a
   * `screenshot` message so the orchestrator runs OCR + LLM on it.
   */
  async captureScreenshot(): Promise<void> {
    if (!this.displayStream || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new LiveClientError('not-live', 'live session is not active');
    }
    const [videoTrack] = this.displayStream.getVideoTracks();
    if (!videoTrack) {
      throw new LiveClientError('no-video', 'this share has no video track — re-share with video');
    }
    // MediaStreamTrackProcessor works on Chromium; ImageCapture is broader. Use
    // ImageCapture when available for simplicity; fall back to the track via a
    // temporary <video> + canvas.drawImage.
    let blob: Blob;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ImageCaptureCtor = (globalThis as any).ImageCapture;
    if (ImageCaptureCtor) {
      const cap = new ImageCaptureCtor(videoTrack);
      const bitmap = (await cap.grabFrame()) as ImageBitmap;
      blob = await bitmapToPngBlob(bitmap);
      bitmap.close?.();
    } else {
      blob = await fallbackFrameCapture(videoTrack);
    }
    const pngBase64 = await blobToBase64(blob);
    this.sendJson({ type: 'screenshot', pngBase64 });
  }

  /** Send an interviewer-typed question (`hint` message) the user wants answered now. */
  sendHint(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    this.sendJson({ type: 'hint', text: trimmed.slice(0, 2_000) });
  }

  /** Close everything. Safe to call multiple times. */
  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.sendJson({ type: 'session.stop' });
      } catch { /* ignore */ }
      try { this.ws.close(1000, 'client-stop'); } catch { /* ignore */ }
    }
    this.ws = null;
    for (const p of this.processors) {
      try { p.disconnect(); } catch { /* ignore */ }
      p.onaudioprocess = null;
    }
    this.processors = [];
    if (this.displayStream) {
      for (const t of this.displayStream.getTracks()) t.stop();
      this.displayStream = null;
    }
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop();
      this.micStream = null;
    }
    if (this.audioCtx) {
      try { await this.audioCtx.close(); } catch { /* ignore */ }
      this.audioCtx = null;
    }
  }

  // ---- internals ---------------------------------------------------------

  private wireTrack(
    stream: MediaStream,
    ratio: number,
    source: 'interviewer' | 'candidate',
  ): void {
    if (!this.audioCtx) return;
    const audioSource = this.audioCtx.createMediaStreamSource(stream);
    const proc = this.audioCtx.createScriptProcessor(4096, 1, 1);
    // Each track keeps its own pending buffer so a frame only ever contains samples from
    // one source. Mixing in `this.pendingSamples` would let an interviewer chunk spill
    // into a frame we tag as candidate (or vice-versa), ruining diarization.
    const pending: Int16Array[] = [];
    let pendingCount = 0;
    const tag = source === 'candidate' ? SOURCE_TAG_CANDIDATE : SOURCE_TAG_INTERVIEWER;
    proc.onaudioprocess = (ev) => {
      if (this.closed) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm = downsampleAndPack(input, ratio);
      pending.push(pcm);
      pendingCount += pcm.length;
      while (pendingCount >= FRAME_SAMPLES) {
        const out = new Int16Array(FRAME_SAMPLES);
        let written = 0;
        while (written < FRAME_SAMPLES && pending.length > 0) {
          const head = pending[0]!;
          const need = FRAME_SAMPLES - written;
          if (head.length <= need) {
            out.set(head, written);
            written += head.length;
            pending.shift();
          } else {
            out.set(head.subarray(0, need), written);
            written += need;
            pending[0] = head.subarray(need);
          }
        }
        pendingCount -= FRAME_SAMPLES;
        this.sendFrame(out, tag);
      }
    };
    audioSource.connect(proc);
    proc.connect(this.audioCtx.destination);
    this.processors.push(proc);
  }

  /**
   * Prepend a 1-byte source tag and ship the frame. Total 641 bytes, matching the
   * server's diarize-mode frame layout (AUDIO_BYTES_PER_FRAME_DIARIZED).
   *
   * Gated on `sessionReady` so we never race session.start — the server silently drops
   * any binary arriving in the `awaiting-start` state, which caused the "transcripts
   * never appear" regression tracked down in Phase 13 diagnostics.
   */
  private sendFrame(samples: Int16Array, sourceTag: number): void {
    if (!this.sessionReady) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = new Uint8Array(1 + samples.byteLength);
    payload[0] = sourceTag;
    payload.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 1);
    this.ws.send(payload.buffer);
  }

  private openWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.opts.wsUrl.replace(/\/$/, '')}/ws/session?token=${encodeURIComponent(this.opts.token)}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      let opened = false;
      ws.onopen = () => {
        opened = true;
        console.info('[LiveClient] v13-fix: ws.onopen fired — sending session.start');
        // Kick off the session. Frames will start flowing from the ScriptProcessors.
        this.sendJson({
          type: 'session.start',
          language: this.opts.language ?? 'en',
          mode: this.opts.mode ?? 'auto',
          llm: this.opts.llm ?? 'auto',
          persistTranscripts: this.opts.persistTranscripts ?? true,
          diarize: true,
          ...(this.opts.resumeId ? { resumeId: this.opts.resumeId } : {}),
          ...(this.opts.jdId ? { jdId: this.opts.jdId } : {}),
          ...(this.opts.personaId ? { personaId: this.opts.personaId } : {}),
          ...(this.opts.extraInstructions?.trim()
            ? { extraInstructions: this.opts.extraInstructions.trim() }
            : {}),
          ...(this.opts.simpleEnglish ? { simpleEnglish: true } : {}),
        });
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new LiveClientError('ws-failed', 'WebSocket failed to open'));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        this.handleServerText(ev.data);
      };
      ws.onclose = () => {
        this.opts.onEvent({ kind: 'closed' });
      };
    });
  }

  private handleServerText(raw: string): void {
    let msg: { type?: string } & Record<string, unknown>;
    try {
      // Server-sent WS text frames (our own /ws/session protocol). Each field is
      // narrowed via per-type type-guards in the switch below, which gives the same
      // runtime safety as a Zod parse with a fraction of the hot-path cost.
      // eslint-disable-next-line no-restricted-syntax
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // In diarize mode (always on for browser live mode) the server tags each transcript
    // with its source. Fall back to 'interviewer' for older servers / single-channel
    // sessions so the UI still works.
    const src: 'interviewer' | 'candidate' =
      msg['source'] === 'candidate' ? 'candidate' : 'interviewer';
    switch (msg.type) {
      case 'session.ready':
        this.sessionReady = true;
        console.info('[LiveClient] session.ready received — audio frames unblocked');
        this.opts.onEvent({
          kind: 'ready',
          sessionId: String(msg['sessionId'] ?? ''),
          secondsAvailable: Number(msg['secondsAvailable'] ?? 0),
        });
        return;
      case 'transcript.partial':
        this.opts.onEvent({
          kind: 'transcript.partial',
          text: String(msg['text'] ?? ''),
          source: src,
          ts: Number(msg['ts'] ?? Date.now()),
        });
        return;
      case 'transcript.final':
        this.opts.onEvent({
          kind: 'transcript.final',
          text: String(msg['text'] ?? ''),
          source: src,
          isQuestion: msg['isQuestion'] === true,
          ts: Number(msg['ts'] ?? Date.now()),
        });
        return;
      case 'answer.start':
        this.opts.onEvent({
          kind: 'answer.start',
          answerId: String(msg['answerId'] ?? ''),
          provider: String(msg['provider'] ?? ''),
          ...(msg['mode'] ? { mode: String(msg['mode']) } : {}),
        });
        return;
      case 'answer.delta':
        this.opts.onEvent({
          kind: 'answer.delta',
          answerId: String(msg['answerId'] ?? ''),
          text: String(msg['text'] ?? ''),
        });
        return;
      case 'answer.done':
        this.opts.onEvent({
          kind: 'answer.done',
          answerId: String(msg['answerId'] ?? ''),
          latencyMs: Number(msg['latencyMs'] ?? 0),
          totalTokens: Number(msg['totalTokens'] ?? 0),
        });
        return;
      case 'answer.canceled':
        this.opts.onEvent({
          kind: 'answer.canceled',
          answerId: String(msg['answerId'] ?? ''),
          reason: String(msg['reason'] ?? ''),
        });
        return;
      case 'ocr.result': {
        const parsed = msg['parsed'] as { title?: unknown; site?: unknown } | undefined;
        this.opts.onEvent({
          kind: 'ocr.result',
          problemId: String(msg['problemId'] ?? ''),
          ...(parsed?.title && typeof parsed.title === 'string' ? { title: parsed.title } : {}),
          ...(parsed?.site && typeof parsed.site === 'string' ? { site: parsed.site } : {}),
        });
        return;
      }
      case 'error':
        this.opts.onEvent({
          kind: 'error',
          code: String(msg['code'] ?? 'UNKNOWN'),
          message: String(msg['message'] ?? 'unknown error'),
        });
        return;
      default:
        return;
    }
  }

  private sendJson(payload: unknown): void {
    const hasWs = !!this.ws;
    const state = this.ws?.readyState;
    const payloadType = (payload as { type?: string } | null)?.type ?? 'unknown';
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[LiveClient] sendJson SKIPPED', { type: payloadType, hasWs, state });
      return;
    }
    const str = JSON.stringify(payload);
    console.info('[LiveClient] sendJson SENDING', {
      type: payloadType,
      bytes: str.length,
      state,
    });
    this.ws.send(str);
  }
}

export class LiveClientError extends Error {
  constructor(
    readonly code: 'no-audio' | 'no-audio-ctx' | 'not-live' | 'no-video' | 'ws-failed' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'LiveClientError';
  }
}

// ---- helpers ---------------------------------------------------------------

async function bitmapToPngBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new LiveClientError('unknown', 'canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function fallbackFrameCapture(track: MediaStreamTrack): Promise<Blob> {
  // Firefox + older browsers: create a tiny video element, seek, draw to canvas.
  const v = document.createElement('video');
  v.autoplay = true;
  v.muted = true;
  v.playsInline = true;
  v.srcObject = new MediaStream([track]);
  await new Promise<void>((resolve) => {
    v.onloadedmetadata = () => {
      void v.play().catch(() => {
        /* autoplay may be blocked; still proceed */
      });
      // Wait one frame so drawImage has pixels.
      requestAnimationFrame(() => resolve());
    };
  });
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth || 1280;
  canvas.height = v.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new LiveClientError('unknown', 'canvas context unavailable');
  ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
  v.srcObject = null;
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new LiveClientError('unknown', 'canvas.toBlob returned null'))),
      'image/png',
    );
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  // Browsers have no native Buffer — base64-encode via chunked String.fromCharCode so
  // we don't blow the stack on a 2 MB PNG.
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}
