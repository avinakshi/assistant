/**
 * OCR provider interface — pluggable behind Google Vision.
 *
 * Phase 5 scope: Google Cloud Vision TEXT_DETECTION only. AWS Textract / Azure Read are
 * possible alternates if Vision has outages or we hit quota; the shape below lets us swap
 * without touching callers.
 */
import type { OcrResult } from './types';

export interface OcrProvider {
  readonly name: string;
  /**
   * Extract text from a PNG image buffer.
   * @param png - raw PNG bytes (Buffer or Uint8Array).
   * @param signal - optional abort signal; provider must cancel upstream promptly.
   */
  extract(png: Uint8Array, signal?: AbortSignal): Promise<OcrResult>;
}

export interface OcrError extends Error {
  code: 'AUTH' | 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'UPSTREAM_5XX' | 'UPSTREAM_4XX' | 'NETWORK' | 'UNKNOWN';
  statusCode?: number;
  providerName?: string;
}

export function isOcrError(err: unknown): err is OcrError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}
