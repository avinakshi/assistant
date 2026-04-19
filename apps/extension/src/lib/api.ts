/**
 * HTTP wrapper for the extension → api. Fetches go through the browser with the
 * stored JWT as a Bearer header.
 *
 * The coding-answer endpoint streams as NDJSON (application/x-ndjson). We consume the
 * response body as a ReadableStream and yield typed events — the popup appends delta
 * text live so the user watches the answer write itself.
 */

export type CodingAnswerEvent =
  | { readonly kind: 'start'; readonly provider: string }
  | { readonly kind: 'delta'; readonly text: string }
  | {
      readonly kind: 'done';
      readonly provider: string;
      readonly latencyMs: number;
      readonly chars: number;
    }
  | { readonly kind: 'error'; readonly message: string };

export interface CodingAnswerInput {
  readonly title?: string;
  readonly description?: string;
  readonly examples?: readonly {
    readonly input?: string;
    readonly output?: string;
    readonly explanation?: string;
  }[];
  readonly constraints?: readonly string[];
  readonly difficulty?: string;
  readonly rawText: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: 'auth' | 'network' | 'upstream' | 'unknown',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const FETCH_TIMEOUT_MS = 60_000;

/**
 * Stream coding-answer events. Emits `start`, then one or more `delta`, then `done` on
 * success; or `error` on a stream-time failure (HTTP failures throw ApiError before any
 * event fires).
 */
export async function* streamCodingAnswer(opts: {
  readonly apiBaseUrl: string;
  readonly token: string;
  readonly problem: CodingAnswerInput;
  readonly language?: string;
  readonly signal?: AbortSignal;
}): AsyncGenerator<CodingAnswerEvent, void, void> {
  const url = `${opts.apiBaseUrl.replace(/\/$/, '')}/api/extension/coding-answer`;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  // Chain an externally provided signal if any.
  const userAbort = opts.signal
    ? () => {
        if (opts.signal?.aborted) ac.abort();
      }
    : null;
  if (userAbort) opts.signal?.addEventListener('abort', userAbort);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.token}`,
        accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        problem: opts.problem,
        language: opts.language ?? 'en',
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(to);
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(msg, 0, 'network');
  }

  if (res.status === 401 || res.status === 403) {
    clearTimeout(to);
    throw new ApiError('Signed-out or invalid token', res.status, 'auth');
  }
  if (!res.ok) {
    clearTimeout(to);
    const body = await res.text().catch(() => '');
    throw new ApiError(`HTTP ${res.status}: ${body.slice(0, 200)}`, res.status, 'upstream');
  }
  if (!res.body) {
    clearTimeout(to);
    throw new ApiError('No response body', res.status, 'upstream');
  }

  try {
    for await (const event of readNdjson(res.body)) {
      yield event;
    }
  } finally {
    clearTimeout(to);
    if (userAbort) opts.signal?.removeEventListener('abort', userAbort);
  }
}

/**
 * Read an application/x-ndjson stream — one JSON event per line. Exported so tests can
 * feed in a fake ReadableStream without mocking fetch.
 */
export async function* readNdjson(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<CodingAnswerEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) {
          const ev = parseEvent(line);
          if (ev) yield ev;
        }
        nl = buffer.indexOf('\n');
      }
    }
    // Final flush.
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const ev = parseEvent(buffer.trim());
      if (ev) yield ev;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function parseEvent(line: string): CodingAnswerEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const type = o['type'];
  if (type === 'start') {
    const provider = typeof o['provider'] === 'string' ? o['provider'] : '';
    return { kind: 'start', provider };
  }
  if (type === 'delta') {
    const text = typeof o['text'] === 'string' ? o['text'] : '';
    return { kind: 'delta', text };
  }
  if (type === 'done') {
    return {
      kind: 'done',
      provider: typeof o['provider'] === 'string' ? o['provider'] : '',
      latencyMs: typeof o['latencyMs'] === 'number' ? o['latencyMs'] : 0,
      chars: typeof o['chars'] === 'number' ? o['chars'] : 0,
    };
  }
  if (type === 'error') {
    return {
      kind: 'error',
      message: typeof o['message'] === 'string' ? o['message'] : 'unknown error',
    };
  }
  return null;
}
