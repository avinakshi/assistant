/**
 * Deepgram Nova-3 streaming STT client.
 *
 * Reference: docs/INTERVIEW-COPILOT-COMPLETE.txt §02 SPEC.md 5.3.
 *
 * Wire details:
 *   URL: wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1
 *        &model=nova-3&language=<lang>&smart_format=true&punctuate=true&interim_results=true
 *        &endpointing=300&utterance_end_ms=1000&vad_events=true
 *   Auth: `Authorization: Token <api_key>` header on the upgrade request.
 *   Keepalive: JSON `{"type":"KeepAlive"}` every 5 s.
 *   Close: send `{"type":"CloseStream"}`, then close().
 *
 * Events we care about:
 *   - Results.channel.alternatives[0].transcript + `is_final` flag
 *   - UtteranceEnd (future: hook question detector here for silence-based triggering)
 *   - SpeechStarted (future: cancel in-flight answers)
 *   - Metadata / errors via close code
 *
 * Reconnect policy: exponential backoff, 5 attempts max. On the 3rd consecutive 5xx inside
 * a 60 s rolling window, the router flips us off to AssemblyAI — see router.ts.
 */
import WebSocket from 'ws';
import {
  type SttConnectOptions,
  type SttError,
  type SttProvider,
  type SttSession,
} from './provider';

export interface DeepgramConfig {
  apiKey: string;
  /** Override the base URL in tests — lets us point at a mock server. */
  baseUrl?: string;
  /** Override the keepalive interval in tests. */
  keepaliveMs?: number;
}

const DEFAULT_BASE_URL = 'wss://api.deepgram.com/v1/listen';
const KEEPALIVE_MS_DEFAULT = 5_000;
const CONNECT_TIMEOUT_MS = 8_000;

export function buildDeepgramUrl(
  opts: { language: string; sampleRateHz: number },
  base = DEFAULT_BASE_URL,
): string {
  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: String(opts.sampleRateHz),
    channels: '1',
    model: 'nova-3',
    language: opts.language,
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
  });
  return `${base}?${params.toString()}`;
}

export class DeepgramProvider implements SttProvider {
  readonly name = 'deepgram';
  constructor(private readonly config: DeepgramConfig) {}

  async connect(opts: SttConnectOptions): Promise<SttSession> {
    const url = buildDeepgramUrl(
      { language: opts.language, sampleRateHz: opts.sampleRateHz },
      this.config.baseUrl,
    );
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.config.apiKey}` },
      handshakeTimeout: CONNECT_TIMEOUT_MS,
    });
    const session = new DeepgramSession(ws, opts, this.config.keepaliveMs ?? KEEPALIVE_MS_DEFAULT);
    await session.waitForOpen();
    return session;
  }
}

class DeepgramSession implements SttSession {
  readonly providerName = 'deepgram';
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly opts: SttConnectOptions,
    private readonly keepaliveMs: number,
  ) {
    ws.on('message', (data, isBinary) => this.handleMessage(data, isBinary));
    ws.on('close', (code, reason) => this.handleClose(code, reason));
    ws.on('error', (err) => this.handleError(err));
    ws.on('unexpected-response', (_req, res) => {
      this.opts.onError(this.mapHttpError(res.statusCode ?? 0));
    });
  }

  waitForOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Deepgram open timeout'));
        try {
          this.ws.terminate();
        } catch {
          /* ignore */
        }
      }, CONNECT_TIMEOUT_MS);
      this.ws.once('open', () => {
        clearTimeout(timeout);
        this.startKeepalive();
        this.opts.onReady?.();
        resolve();
      });
      this.ws.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  pushFrame(frame: Buffer): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(frame, { binary: true });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopKeepalive();
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
    } catch {
      /* ignore */
    }
    this.ws.close(1000, 'client close');
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, this.keepaliveMs);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private handleMessage(data: unknown, isBinary: boolean): void {
    if (isBinary) return; // Deepgram server never sends binary back to us
    const text =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.from(data as ArrayBuffer).toString('utf8');
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = parseDeepgramEvent(msg);
    if (parsed.kind === 'transcript') {
      const ts = Date.now();
      if (parsed.isFinal) this.opts.onFinal(parsed.text, ts);
      else this.opts.onPartial(parsed.text, ts);
    }
    // UtteranceEnd / SpeechStarted reserved for Phase 4 silence triggering.
  }

  private handleClose(code: number, reason: Buffer): void {
    this.stopKeepalive();
    if (this.closed) {
      this.opts.onClose('client-closed');
      return;
    }
    // Normal close (1000) and going-away (1001) are server initiated cleanly.
    if (code === 1000 || code === 1001) {
      this.opts.onClose('server-closed');
    } else {
      this.opts.onError({
        code: 'NETWORK',
        message: `unexpected close ${code}: ${reason.toString('utf8')}`,
      });
      this.opts.onClose('error');
    }
  }

  private handleError(err: Error): void {
    this.opts.onError({ code: 'NETWORK', message: err.message, cause: err });
  }

  private mapHttpError(status: number): SttError {
    if (status === 401 || status === 403) {
      return { code: 'AUTH', message: `Deepgram auth failed (${status})`, statusCode: status };
    }
    if (status >= 500) {
      return { code: 'UPSTREAM_5XX', message: `Deepgram ${status}`, statusCode: status };
    }
    if (status >= 400) {
      return { code: 'UPSTREAM_4XX', message: `Deepgram ${status}`, statusCode: status };
    }
    return { code: 'UNKNOWN', message: `Deepgram HTTP ${status}`, statusCode: status };
  }
}

type ParsedEvent =
  | { kind: 'transcript'; text: string; isFinal: boolean }
  | { kind: 'utterance-end'; lastWordEndMs: number }
  | { kind: 'speech-started' }
  | { kind: 'metadata' }
  | { kind: 'unknown' };

/** Exported for tests. Tolerates missing / partial payloads. */
export function parseDeepgramEvent(msg: unknown): ParsedEvent {
  if (typeof msg !== 'object' || msg === null) return { kind: 'unknown' };
  const obj = msg as Record<string, unknown>;
  switch (obj['type']) {
    case 'Results': {
      const channel = obj['channel'] as { alternatives?: Array<{ transcript?: string }> } | undefined;
      const alt = channel?.alternatives?.[0];
      const text = alt?.transcript ?? '';
      const isFinal = Boolean(obj['is_final']);
      if (!text) return { kind: 'unknown' };
      return { kind: 'transcript', text, isFinal };
    }
    case 'UtteranceEnd':
      return { kind: 'utterance-end', lastWordEndMs: Number(obj['last_word_end'] ?? 0) * 1000 };
    case 'SpeechStarted':
      return { kind: 'speech-started' };
    case 'Metadata':
      return { kind: 'metadata' };
    default:
      return { kind: 'unknown' };
  }
}
