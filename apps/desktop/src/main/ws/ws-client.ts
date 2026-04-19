/**
 * WebSocket client for desktop → api.
 *
 * Supports two routes:
 *   - `/ws/echo`     — Phase 1 diagnostic. No auth. Server echoes `echo.stats`.
 *   - `/ws/session`  — Phase 3 real session. Shared-secret token (JWT in Phase 6).
 *                      Server returns transcript + answer events.
 *
 * Contract:
 *   - Binary WS messages = raw PCM frames (640 bytes each).
 *   - Text WS messages = JSON `ServerMessage` values.
 *   - Reconnect with exponential backoff on close/error (1s → 30s cap).
 *   - On `/ws/session` reconnect: re-send `session.start` so the server re-opens STT.
 */
import WebSocket from 'ws';
import {
  AUDIO_BYTES_PER_FRAME,
  decodeServerMessage,
  type ServerMessage,
} from '@repo/shared';
import { logger } from '../logger';

export type WsRoute = 'echo' | 'session';

export interface WsClientOptions {
  /** Base URL without path, e.g. ws://localhost:3001 */
  url: string;
  /** Which route to connect. Defaults to 'echo' for Phase 1 compatibility. */
  route?: WsRoute;
  /** Required for 'session' route — shared secret in Phase 3, JWT in Phase 6. */
  token?: string;
  /** On every reconnect (and first connect once handshake is sent), this is fired. */
  onReady?: () => void;
  /** Fired with every parsed server message. Caller dispatches to UI/logging. */
  onMessage?: (msg: ServerMessage) => void;
  /** Called when the session state machine decides to stop (auth failure, quota, etc.). */
  onTerminalError?: (msg: Extract<ServerMessage, { type: 'error' }>) => void;
  reconnectBackoffMs?: number[];
}

export interface SessionStartParams {
  resumeId?: string;
  jdId?: string;
  personaId?: string;
  mode?: 'auto' | 'behavioral' | 'coding' | 'system_design';
  llm?: 'auto' | 'claude' | 'gpt-5' | 'gpt-4.1' | 'gemini';
  language?: string;
  /** Phase 9: persist per-turn transcripts + answers for post-session review. */
  persistTranscripts?: boolean;
  /**
   * Free-form bias threaded into every LLM answer. Useful when the desktop is running
   * in shared-secret mode (no Supabase sign-in, no resume/JD in the DB) — the user
   * can still tailor answers to a role by setting SESSION_EXTRA_INSTRUCTIONS in env.
   */
  extraInstructions?: string;
  /** Phase 13f. CEFR A2-B1 English style for non-native speakers. */
  simpleEnglish?: boolean;
}

const DEFAULT_BACKOFF = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export class WsClient {
  private ws: WebSocket | null = null;
  private shutdown = false;
  private reconnectAttempt = 0;
  private readonly backoff: number[];
  private readonly route: WsRoute;
  private sessionParams: SessionStartParams | null = null;
  private statsListeners: ((msg: Extract<ServerMessage, { type: 'echo.stats' }>) => void)[] = [];
  private token: string | undefined;

  constructor(private readonly options: WsClientOptions) {
    this.backoff = options.reconnectBackoffMs ?? DEFAULT_BACKOFF;
    this.route = options.route ?? 'echo';
    this.token = options.token;
  }

  /**
   * Replace the session token and reopen the socket so the new credentials take effect
   * on the next handshake. No-op on the echo route.
   *
   * The auto-reconnect path will re-send `session.start` if we had an active session,
   * so callers don't need to re-issue `startSession` themselves.
   */
  setToken(token: string | undefined): void {
    if (this.route !== 'session') return;
    if (this.token === token) return;
    this.token = token;
    if (this.ws) {
      this.ws.close(1000, 'token rotated');
    }
  }

  async connect(): Promise<void> {
    this.shutdown = false;
    await this.openOnce();
  }

  async disconnect(): Promise<void> {
    this.shutdown = true;
    if (this.ws) {
      this.ws.close(1000, 'client shutdown');
      this.ws = null;
    }
  }

  /**
   * Kick off a real session. Caches params so reconnect can re-send the handshake.
   * No-op on the echo route.
   */
  startSession(params: SessionStartParams): void {
    if (this.route !== 'session') {
      logger.warn({}, 'startSession called on echo route — ignored');
      return;
    }
    this.sessionParams = { language: 'en', mode: 'auto', llm: 'auto', ...params };
    this.sendHandshake();
  }

  stopSession(): void {
    this.sessionParams = null;
    this.sendJson({ type: 'session.stop' });
  }

  sendFrame(samples: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    if (bytes.byteLength !== AUDIO_BYTES_PER_FRAME) {
      logger.warn({ bytes: bytes.byteLength }, 'dropping malformed frame pre-send');
      return;
    }
    this.ws.send(bytes, { binary: true });
  }

  /**
   * Ship a PNG screenshot over the session WS. The server runs OCR + parser and responds
   * with an `ocr.result` message, then attaches the parsed CodingProblem to the next
   * question's answer.
   */
  sendScreenshot(png: Uint8Array): { ok: true } | { ok: false; reason: string } {
    if (this.route !== 'session') {
      return { ok: false, reason: 'not on /ws/session route' };
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { ok: false, reason: 'ws not open' };
    }
    // Node's Buffer is a Uint8Array; base64-encode in-place.
    const pngBase64 = Buffer.from(png.buffer, png.byteOffset, png.byteLength).toString('base64');
    this.sendJson({ type: 'screenshot', pngBase64 });
    return { ok: true };
  }

  onStats(listener: (msg: Extract<ServerMessage, { type: 'echo.stats' }>) => void): void {
    this.statsListeners.push(listener);
  }

  private async openOnce(): Promise<void> {
    const path = this.route === 'session' ? '/ws/session' : '/ws/echo';
    const qs = this.route === 'session' && this.token ? `?token=${encodeURIComponent(this.token)}` : '';
    const url = `${this.options.url}${path}${qs}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempt = 0;
      logger.info({ route: this.route }, 'ws connected');
      if (this.route === 'session' && this.sessionParams) {
        this.sendHandshake();
      } else {
        this.options.onReady?.();
      }
    });

    ws.on('message', (data) => this.handleIncoming(data));

    ws.on('close', (code, reason) => {
      logger.info({ code, reason: reason.toString() }, 'ws closed');
      this.ws = null;
      if (!this.shutdown) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.warn({ err: String(err) }, 'ws error');
    });
  }

  private handleIncoming(data: unknown): void {
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (Buffer.isBuffer(data)) {
      text = data.toString('utf8');
    } else {
      return;
    }
    let msg: ServerMessage;
    try {
      msg = decodeServerMessage(text);
    } catch (err) {
      logger.warn({ err: String(err) }, 'undecodable server message');
      return;
    }
    if (msg.type === 'echo.stats') {
      for (const l of this.statsListeners) l(msg);
    }
    if (msg.type === 'error') {
      logger.warn({ code: msg.code, message: msg.message }, 'server error');
      if (msg.code === 'AUTH' || msg.code === 'QUOTA_EXCEEDED') {
        this.options.onTerminalError?.(msg);
      }
    }
    if (msg.type === 'session.ready') {
      this.options.onReady?.();
    }
    this.options.onMessage?.(msg);
  }

  private sendHandshake(): void {
    if (!this.sessionParams) return;
    const params = this.sessionParams;
    this.sendJson({
      type: 'session.start',
      mode: params.mode ?? 'auto',
      llm: params.llm ?? 'auto',
      language: params.language ?? 'en',
      ...(params.resumeId ? { resumeId: params.resumeId } : {}),
      ...(params.jdId ? { jdId: params.jdId } : {}),
      ...(params.personaId ? { personaId: params.personaId } : {}),
      ...(params.persistTranscripts !== undefined
        ? { persistTranscripts: params.persistTranscripts }
        : {}),
      ...(params.extraInstructions && params.extraInstructions.trim().length > 0
        ? { extraInstructions: params.extraInstructions.trim() }
        : {}),
      ...(params.simpleEnglish ? { simpleEnglish: true } : {}),
    });
  }

  private sendJson(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private scheduleReconnect(): void {
    const idx = Math.min(this.reconnectAttempt, this.backoff.length - 1);
    const delay = this.backoff[idx] ?? 30_000;
    this.reconnectAttempt += 1;
    logger.info({ delayMs: delay, attempt: this.reconnectAttempt }, 'reconnecting');
    setTimeout(() => {
      if (!this.shutdown) void this.openOnce();
    }, delay);
  }
}
