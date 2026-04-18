import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges Tailwind classes and dedupes conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });
  it('joins conditional objects', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });
});
