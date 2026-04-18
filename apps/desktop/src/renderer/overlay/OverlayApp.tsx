import { useEffect } from 'react';
import { useOverlayStore } from './store';
import { RmsBar } from './RmsBar';
import { TranscriptPane } from './TranscriptPane';
import { AnswerPane } from './AnswerPane';

export function OverlayApp() {
  const connected = useOverlayStore((s) => s.connected);
  const pushStats = useOverlayStore((s) => s.pushStats);
  const setConnected = useOverlayStore((s) => s.setConnected);
  const pushPartial = useOverlayStore((s) => s.pushPartial);
  const pushFinal = useOverlayStore((s) => s.pushFinal);
  const pushSessionEvent = useOverlayStore((s) => s.pushSessionEvent);
  const answerStart = useOverlayStore((s) => s.answerStart);
  const answerDelta = useOverlayStore((s) => s.answerDelta);
  const answerDone = useOverlayStore((s) => s.answerDone);
  const answerCanceled = useOverlayStore((s) => s.answerCanceled);
  const pushUpdater = useOverlayStore((s) => s.pushUpdater);
  const updater = useOverlayStore((s) => s.updater);

  useEffect(() => {
    const api = window.ic;
    if (!api) return;
    const offStats = api.onEchoStats((p) => pushStats(p));
    const offPartial = api.onTranscriptPartial((p) => pushPartial(p));
    const offFinal = api.onTranscriptFinal((p) => pushFinal(p));
    const offSession = api.onSessionEvent((p) => pushSessionEvent(p));
    const offAStart = api.onAnswerStart((p) => answerStart(p));
    const offADelta = api.onAnswerDelta((p) => answerDelta(p));
    const offADone = api.onAnswerDone((p) => answerDone(p));
    const offACanceled = api.onAnswerCanceled((p) => answerCanceled(p));
    const offUpdater = api.onUpdaterState?.((p) => pushUpdater(p));
    return () => {
      offStats();
      offPartial();
      offFinal();
      offSession();
      offAStart();
      offADelta();
      offADone();
      offACanceled();
      offUpdater?.();
      setConnected(false);
    };
  }, [
    pushStats,
    setConnected,
    pushPartial,
    pushFinal,
    pushSessionEvent,
    answerStart,
    answerDelta,
    answerDone,
    answerCanceled,
    pushUpdater,
  ]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-overlay-border bg-overlay-bg backdrop-blur-md shadow-2xl">
      <header
        className="flex h-7 shrink-0 items-center justify-between border-b border-overlay-border px-3 text-[11px] uppercase tracking-wider text-overlay-dim"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span>interview copilot · overlay</span>
        <span className={connected ? 'text-overlay-accent' : 'text-overlay-dim'}>
          {connected ? 'linked' : 'idle'}
        </span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <RmsBar />
        <TranscriptPane />
        <AnswerPane />
        {updater?.kind === 'downloaded' && (
          <div className="flex items-center justify-between gap-3 border-t border-overlay-border bg-overlay-accent/10 px-4 py-2 text-[11px] text-overlay-accent">
            <span>Update {updater.version} ready</span>
            <button
              type="button"
              onClick={() => void window.ic?.updaterInstall?.()}
              className="rounded bg-overlay-accent px-2 py-0.5 text-[11px] font-medium text-black hover:bg-overlay-accent/90"
            >
              Install + relaunch
            </button>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-overlay-border px-4 py-2 text-[10px] text-overlay-dim">
          <span>
            <kbd className="mx-0.5 rounded border border-overlay-border bg-white/5 px-1">Ctrl</kbd>
            <kbd className="mx-0.5 rounded border border-overlay-border bg-white/5 px-1">Shift</kbd>
            <kbd className="mx-0.5 rounded border border-overlay-border bg-white/5 px-1">H</kbd>
            <span className="ml-2">hide</span>
          </span>
          <span>
            <kbd className="mx-0.5 rounded border border-overlay-border bg-white/5 px-1">Ctrl</kbd>
            <kbd className="mx-0.5 rounded border border-overlay-border bg-white/5 px-1">Shift</kbd>
            <kbd className="mx-0.5 rounded border border-overlay-border bg-white/5 px-1">C</kbd>
            <span className="ml-2">screenshot</span>
          </span>
        </div>
      </main>
    </div>
  );
}
