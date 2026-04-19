import { describe, it, expect } from 'vitest';
import { buildExtraInstructions, SIMPLE_ENGLISH_DIRECTIVE } from './session-orchestrator';

describe('buildExtraInstructions', () => {
  it('returns null when every input is empty', () => {
    expect(buildExtraInstructions(null, null)).toBeNull();
    expect(buildExtraInstructions('', '  ', '')).toBeNull();
  });

  it('returns the user instructions alone when others are empty', () => {
    expect(buildExtraInstructions('answer in Hindi', null)).toBe('answer in Hindi');
    expect(buildExtraInstructions('answer in Hindi', '')).toBe('answer in Hindi');
  });

  it('returns the gap alone when user instructions are empty', () => {
    expect(buildExtraInstructions(null, 'gaps: Kubernetes')).toBe('gaps: Kubernetes');
  });

  it('stacks user instructions BEFORE the gap when both are present', () => {
    const out = buildExtraInstructions('emphasize leadership', 'Gaps to defend:\n- Kubernetes');
    expect(out).toBe('emphasize leadership\n\nGaps to defend:\n- Kubernetes');
  });

  it('appends a directive after user + gap when supplied', () => {
    const out = buildExtraInstructions('emphasize leadership', 'gap', SIMPLE_ENGLISH_DIRECTIVE);
    expect(out).toBe(`emphasize leadership\n\ngap\n\n${SIMPLE_ENGLISH_DIRECTIVE}`);
  });

  it('returns only the directive when user + gap are empty', () => {
    expect(buildExtraInstructions(null, null, SIMPLE_ENGLISH_DIRECTIVE)).toBe(
      SIMPLE_ENGLISH_DIRECTIVE,
    );
  });

  it('trims whitespace from every input', () => {
    expect(buildExtraInstructions('  hi\n\n', '  there  ')).toBe('hi\n\nthere');
  });
});
