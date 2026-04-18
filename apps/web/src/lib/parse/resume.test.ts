import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseResumeFile } from './resume';

/**
 * We only exercise the deterministic plain-text path here. PDF/DOCX extraction depends on
 * native libs that are slow to spin up in unit tests, and the LLM summary is a best-effort
 * sidecar the caller can always survive without.
 */
describe('parseResumeFile — text/plain', () => {
  const origKey = process.env.GOOGLE_API_KEY;
  beforeEach(() => {
    delete process.env.GOOGLE_API_KEY; // force the LLM summary to short-circuit
  });
  afterEach(() => {
    if (origKey !== undefined) process.env.GOOGLE_API_KEY = origKey;
  });

  it('returns trimmed raw text from a .txt upload', async () => {
    const bytes = new TextEncoder().encode('  Jane Doe\nSenior Eng\n');
    const out = await parseResumeFile({
      bytes,
      mimeType: 'text/plain',
      filename: 'resume.txt',
    });
    expect(out.rawText).toBe('Jane Doe\nSenior Eng');
    expect(out.summary).toBeUndefined();
  });

  it('clips absurdly long resumes to the MAX_TEXT_CHARS cap', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(100_000));
    const out = await parseResumeFile({
      bytes,
      mimeType: 'text/plain',
      filename: 'huge.txt',
    });
    expect(out.rawText.length).toBe(20_000);
  });

  it('rejects unknown file types', async () => {
    await expect(
      parseResumeFile({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        filename: 'photo.png',
      }),
    ).rejects.toThrow(/unsupported/i);
  });
});
