/**
 * HTTP wrapper for the extension → api. Fetches go through the browser with the
 * stored JWT as a Bearer header.
 */

export interface CodingAnswerResponse {
  readonly answer: string;
  readonly provider: string;
  readonly latencyMs: number;
}

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

const FETCH_TIMEOUT_MS = 30_000;

export async function fetchCodingAnswer(opts: {
  readonly apiBaseUrl: string;
  readonly token: string;
  readonly problem: CodingAnswerInput;
  readonly language?: string;
}): Promise<CodingAnswerResponse> {
  const url = `${opts.apiBaseUrl.replace(/\/$/, '')}/api/extension/coding-answer`;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        problem: opts.problem,
        language: opts.language ?? 'en',
      }),
      signal: ac.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new ApiError('Signed-out or invalid token', res.status, 'auth');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiError(`HTTP ${res.status}: ${body.slice(0, 200)}`, res.status, 'upstream');
    }
    const body = (await res.json()) as unknown;
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { answer?: unknown }).answer !== 'string' ||
      typeof (body as { provider?: unknown }).provider !== 'string'
    ) {
      throw new ApiError('Malformed response', 200, 'upstream');
    }
    const b = body as { answer: string; provider: string; latencyMs?: number };
    return { answer: b.answer, provider: b.provider, latencyMs: b.latencyMs ?? 0 };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(msg, 0, 'network');
  } finally {
    clearTimeout(to);
  }
}
