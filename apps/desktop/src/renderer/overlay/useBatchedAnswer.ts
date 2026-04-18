import { useEffect, useRef, useState } from 'react';
import { useOverlayStore } from './store';

/**
 * Return a string that mirrors the active answer text, throttled to one update per
 * animation frame. Every token delta updates the Zustand store; without this batching,
 * Electron can't keep up with rapid deltas from Claude/GPT streaming at ~100 tokens/sec.
 */
export function useBatchedAnswerText(): string {
  const raw = useOverlayStore((s) => s.activeAnswer?.text ?? '');
  const [batched, setBatched] = useState(raw);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setBatched(raw);
      rafRef.current = null;
    });
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [raw]);

  return batched;
}
