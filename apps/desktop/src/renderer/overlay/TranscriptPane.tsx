import { useOverlayStore } from './store';
import { cn } from '../lib/cn';

/**
 * 3-line transcript display.
 *
 * Final lines at top (most-recent last, dimmer as they age), partial stream at the bottom in
 * lighter text per SPEC §02 Part 3 / Phase 3 spec. We display only the last 3 finals because
 * the overlay is small and users read forward — older context moves to the Phase 4 history
 * panel / post-session review.
 */
const VISIBLE_FINAL_COUNT = 3;

export function TranscriptPane() {
  const finals = useOverlayStore((s) => s.transcriptFinals);
  const partial = useOverlayStore((s) => s.transcriptPartial);
  const visible = finals.slice(-VISIBLE_FINAL_COUNT);

  return (
    <section
      className="flex flex-col gap-1 border-t border-overlay-border px-4 py-3"
      data-testid="transcript-pane"
    >
      <div className="text-[10px] uppercase tracking-wider text-overlay-dim">transcript</div>
      <div className="flex flex-col gap-0.5 text-[12px] leading-snug">
        {visible.length === 0 && !partial ? (
          <div className="italic text-overlay-dim">listening…</div>
        ) : (
          <>
            {visible.map((f, i) => (
              <div
                key={f.id}
                className={cn(
                  'whitespace-pre-wrap',
                  i < visible.length - 1 ? 'text-overlay-dim' : 'text-overlay-text',
                  f.isQuestion && 'text-overlay-accent',
                )}
                data-testid="transcript-final"
                data-is-question={f.isQuestion}
              >
                {f.text}
              </div>
            ))}
            {partial && (
              <div
                className="whitespace-pre-wrap italic text-overlay-dim/80"
                data-testid="transcript-partial"
              >
                {partial}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
