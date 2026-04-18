/**
 * STT provider interface — pluggable between Deepgram (primary) and AssemblyAI (fallback).
 *
 * Contract:
 *   - `connect()` opens a bidirectional streaming session. Returns an SttSession the caller
 *     drives by pushing PCM frames and listening for transcript events.
 *   - All providers normalize to the same event shape (partial / final / error / close).
 *   - `close()` must be idempotent — the session orchestrator may call it from multiple
 *     places (client disconnect, quota exceeded, shutdown).
 */

export type SttLanguage = string; // BCP-47-ish ('en', 'en-IN', 'hi', 'te', …)

export interface SttConnectOptions {
  language: SttLanguage;
  /** Deepgram sample rate; loopback pipeline emits 16 kHz so this is usually 16000. */
  sampleRateHz: number;
  onPartial(text: string, ts: number): void;
  onFinal(text: string, ts: number): void;
  onError(err: SttError): void;
  onClose(reason: SttCloseReason): void;
  onReady?: () => void;
}

export interface SttSession {
  /** Forward one PCM frame (640 bytes of int16 mono @ 16 kHz) upstream. */
  pushFrame(frame: Buffer): void;
  close(): Promise<void>;
  readonly providerName: string;
}

export interface SttProvider {
  readonly name: string;
  connect(opts: SttConnectOptions): Promise<SttSession>;
}

export interface SttError {
  code: 'UPSTREAM_5XX' | 'UPSTREAM_4XX' | 'NETWORK' | 'PROTOCOL' | 'AUTH' | 'UNKNOWN';
  message: string;
  statusCode?: number;
  /** Original cause for logging; never forwarded to the client verbatim. */
  cause?: unknown;
}

export type SttCloseReason =
  | 'client-closed'
  | 'server-closed'
  | 'error'
  | 'timeout'
  | 'quota-exceeded';
