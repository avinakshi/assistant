import { describe, it, expect } from 'vitest';
import { blobToBase64 } from './live-client';

describe('blobToBase64', () => {
  it('round-trips a small byte payload through base64', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 255, 128, 64]);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const encoded = await blobToBase64(blob);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it('handles large payloads (>32KB chunk boundary) without corruption', async () => {
    // The implementation chunks at 0x8000 to avoid stack-size issues with
    // String.fromCharCode(...spread). Cross that boundary to pin the behavior.
    const size = 0x8000 * 2 + 123;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i & 0xff;
    const blob = new Blob([bytes]);
    const encoded = await blobToBase64(blob);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(size);
    expect(decoded[0]).toBe(0);
    expect(decoded[size - 1]).toBe(bytes[size - 1]);
  });

  it('produces empty string for an empty blob', async () => {
    const encoded = await blobToBase64(new Blob([]));
    expect(encoded).toBe('');
  });
});
