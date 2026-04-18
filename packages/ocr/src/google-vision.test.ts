import { describe, expect, it } from 'vitest';
import { extractFullText } from './google-vision';

describe('extractFullText', () => {
  it('prefers fullTextAnnotation.text when present', () => {
    const payload = {
      responses: [
        {
          fullTextAnnotation: { text: 'FULL TEXT\nhere' },
          textAnnotations: [{ description: 'should not use' }],
        },
      ],
    };
    expect(extractFullText(payload)).toBe('FULL TEXT\nhere');
  });

  it('falls back to textAnnotations[0].description', () => {
    const payload = {
      responses: [{ textAnnotations: [{ description: 'fallback only' }] }],
    };
    expect(extractFullText(payload)).toBe('fallback only');
  });

  it('returns empty string for empty payloads', () => {
    expect(extractFullText({})).toBe('');
    expect(extractFullText({ responses: [] })).toBe('');
    expect(extractFullText(null)).toBe('');
  });

  it('throws when Vision returns a per-request error', () => {
    expect(() =>
      extractFullText({ responses: [{ error: { code: 7, message: 'PERMISSION_DENIED' } }] }),
    ).toThrow(/PERMISSION_DENIED/);
  });
});
