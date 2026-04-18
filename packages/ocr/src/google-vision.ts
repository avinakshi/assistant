/**
 * Google Cloud Vision OCR — TEXT_DETECTION via the `images:annotate` REST endpoint.
 *
 * Why REST and not `@google-cloud/vision`: the SDK pulls in gRPC + auth libs (~30 MB) for
 * a single-endpoint use case. REST + API key is a handful of lines and runs fine in
 * Electron's Node runtime without native deps.
 *
 * Reference: https://cloud.google.com/vision/docs/ocr
 */
import { createHash } from 'node:crypto';
import type { OcrError, OcrProvider } from './provider';
import type { OcrResult } from './types';

export interface GoogleVisionConfig {
  apiKey: string;
  /** Override for tests. Defaults to the live v1 REST endpoint. */
  baseUrl?: string;
  /** Hard cap on a single request in ms. Vision should answer in < 2 s normally. */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://vision.googleapis.com/v1/images:annotate';
const DEFAULT_TIMEOUT_MS = 8_000;

export class GoogleVisionProvider implements OcrProvider {
  readonly name = 'google-vision';

  constructor(private readonly config: GoogleVisionConfig) {
    if (!config.apiKey) throw new Error('GoogleVisionProvider: apiKey is required');
  }

  async extract(png: Uint8Array, signal?: AbortSignal): Promise<OcrResult> {
    const sha256 = createHash('sha256').update(png).digest('hex');
    const body = JSON.stringify({
      requests: [
        {
          image: { content: uint8ToBase64(png) },
          features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
        },
      ],
    });

    const base = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${base}?key=${encodeURIComponent(this.config.apiKey)}`;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('vision timeout')), timeoutMs);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw toError('NETWORK', 'aborted before send', undefined);
      }
      signal.addEventListener('abort', () => ac.abort(signal.reason), { once: true });
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw toError('NETWORK', err instanceof Error ? err.message : String(err), err);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const code =
        res.status === 401 || res.status === 403
          ? 'AUTH'
          : res.status === 429
            ? 'RATE_LIMITED'
            : res.status >= 500
              ? 'UPSTREAM_5XX'
              : 'UPSTREAM_4XX';
      throw toError(code, `Google Vision ${res.status}: ${text.slice(0, 300)}`, undefined, res.status);
    }

    let json: unknown;
    try {
      json = (await res.json()) as unknown;
    } catch (err) {
      throw toError('UPSTREAM_5XX', 'bad Vision JSON', err);
    }
    const text = extractFullText(json);
    return { text, sha256 };
  }
}

/**
 * Exported for tests. Pulls the `fullTextAnnotation.text` field from a Vision response,
 * falling back to `textAnnotations[0].description` if the fuller structure isn't present.
 */
export function extractFullText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const responses = (payload as { responses?: unknown[] }).responses;
  if (!Array.isArray(responses) || responses.length === 0) return '';
  const r0 = responses[0] as
    | {
        fullTextAnnotation?: { text?: string };
        textAnnotations?: { description?: string }[];
        error?: { message?: string; code?: number };
      }
    | undefined;
  if (r0?.error && typeof r0.error.code === 'number' && r0.error.code !== 0) {
    const err = toError('UPSTREAM_4XX', r0.error.message ?? 'vision error', undefined);
    throw err;
  }
  const fromFull = r0?.fullTextAnnotation?.text;
  if (typeof fromFull === 'string' && fromFull.length > 0) return fromFull;
  const fromFirst = r0?.textAnnotations?.[0]?.description;
  if (typeof fromFirst === 'string' && fromFirst.length > 0) return fromFirst;
  return '';
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Node's Buffer is zero-copy over Uint8Array. Avoids the TextEncoder/FileReader dance.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function toError(
  code: OcrError['code'],
  message: string,
  cause: unknown,
  statusCode?: number,
): OcrError {
  const err = new Error(message) as OcrError;
  err.code = code;
  if (statusCode !== undefined) err.statusCode = statusCode;
  err.providerName = 'google-vision';
  if (cause !== undefined) (err as Error & { cause?: unknown }).cause = cause;
  return err;
}
