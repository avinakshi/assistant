import { useOverlayStore } from './store';
import { useBatchedAnswerText } from './useBatchedAnswer';
import { cn } from '../lib/cn';

/**
 * Streaming answer display.
 *
 * Scrollable column that shows the active answer text (rAF-batched) with a small header
 * bar showing provider + mode + status. Canceled answers fade; done answers show latency.
 */
export function AnswerPane() {
  const active = useOverlayStore((s) => s.activeAnswer);
  const text = useBatchedAnswerText();

  return (
    <section
      className="flex min-h-0 flex-1 flex-col border-t border-overlay-border px-4 py-3"
      data-testid="answer-pane"
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-overlay-dim">
        <span>answer</span>
        <span className="font-mono">
          {active ? (
            <>
              <span className="text-overlay-accent">{active.provider}</span>
              {active.mode ? <span className="ml-2 text-overlay-dim">{active.mode}</span> : null}
              {active.isDone && active.latencyMs !== undefined ? (
                <span className="ml-2 text-overlay-dim">{active.latencyMs}ms</span>
              ) : null}
              {active.isCanceled ? (
                <span className="ml-2 text-red-400/80">canceled</span>
              ) : null}
            </>
          ) : (
            <span className="text-overlay-dim">idle</span>
          )}
        </span>
      </div>
      <div
        className={cn(
          'mt-2 flex-1 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-overlay-text',
          active?.isCanceled && 'opacity-40',
        )}
        data-testid="answer-text"
      >
        {text ||
          (active ? (
            <span className="italic text-overlay-dim">thinking…</span>
          ) : (
            <span className="italic text-overlay-dim">waiting for a question</span>
          ))}
      </div>
    </section>
  );
}
