import { useState } from 'react';
import { useOverlayStore } from './store';
import { useBatchedAnswerText } from './useBatchedAnswer';
import { cn } from '../lib/cn';
import { Markdown } from './Markdown';

function CopyButton({ getText }: { readonly getText: () => string }) {
  const [label, setLabel] = useState('Copy');
  const copy = async () => {
    const t = getText();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setLabel('Copied');
      setTimeout(() => setLabel('Copy'), 1500);
    } catch {
      setLabel('Select + Ctrl+C');
      setTimeout(() => setLabel('Copy'), 2500);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded border border-overlay-border bg-white/5 px-1.5 py-[1px] text-[9px] font-medium text-overlay-text hover:bg-white/10"
    >
      {label}
    </button>
  );
}

/**
 * Streaming answer display + history.
 *
 * The ACTIVE answer (freshly streaming or most recent) sits at the top and gets its
 * text rAF-batched for silky-smooth rendering. PRIOR answers — superseded when the
 * interviewer asked a follow-up — render below in a collapsible history so the
 * candidate can scroll back to an earlier answer they still need to deliver. Without
 * history the overlay felt like Parakeet's *non-free* tiers (each new question wipes
 * the screen) which was a real complaint during Phase-13 testing.
 */
export function AnswerPane() {
  const active = useOverlayStore((s) => s.activeAnswer);
  const history = useOverlayStore((s) => s.answerHistory);
  const text = useBatchedAnswerText();

  return (
    <section
      className="flex min-h-0 flex-1 flex-col border-t border-overlay-border px-4 py-3"
      data-testid="answer-pane"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            Answer
          </span>
          <span className="text-[10px] uppercase tracking-wider text-overlay-dim">
            read this aloud
          </span>
        </div>
        <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
          {active ? (
            <>
              <span className="text-overlay-accent">{active.provider}</span>
              {active.mode ? <span className="text-overlay-dim">{active.mode}</span> : null}
              {active.isDone && active.latencyMs !== undefined ? (
                <span className="text-overlay-dim">{active.latencyMs}ms</span>
              ) : null}
              {active.isCanceled ? (
                <span className="text-red-400/80">canceled</span>
              ) : null}
              {text && <CopyButton getText={() => text} />}
            </>
          ) : (
            <span className="text-overlay-dim">idle</span>
          )}
        </span>
      </div>
      <div className="mt-2 flex-1 overflow-y-auto" data-testid="answer-text" data-selectable="true">
        <div className={cn(active?.isCanceled && 'opacity-40')}>
          {text ? (
            <Markdown src={text} />
          ) : active ? (
            <span className="italic text-overlay-dim">thinking…</span>
          ) : (
            <span className="italic text-overlay-dim">waiting for a question</span>
          )}
        </div>

        {history.length > 0 && (
          <div className="mt-4 border-t border-overlay-border pt-3">
            <div className="text-[10px] uppercase tracking-wider text-overlay-dim">
              previous answers
            </div>
            <ol className="mt-2 flex flex-col gap-3">
              {history
                .slice()
                .reverse()
                .map((h) => (
                  <li
                    key={h.answerId}
                    className="rounded border border-overlay-border bg-white/[0.03] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-overlay-dim">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-overlay-accent/80">{h.provider}</span>
                        {h.mode && <span>{h.mode}</span>}
                        {h.isCanceled && <span className="text-red-400/80">canceled</span>}
                        {h.isDone && h.latencyMs !== undefined && (
                          <span>{h.latencyMs}ms</span>
                        )}
                      </div>
                      {h.text && <CopyButton getText={() => h.text} />}
                    </div>
                    <div
                      data-selectable="true"
                      className={cn('mt-1', h.isCanceled && 'opacity-60')}
                    >
                      {h.text ? (
                        <Markdown src={h.text} />
                      ) : (
                        <span className="italic text-overlay-dim">(empty)</span>
                      )}
                    </div>
                  </li>
                ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
