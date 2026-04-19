import { useEffect, useState } from 'react';
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
  const sessionEvent = useOverlayStore((s) => s.sessionEvent);
  // 'ready' just means the WS handshake succeeded — it does NOT imply the user has
  // started the session. Only 'listening' flips the overlay into the active state.
  const listening = sessionEvent?.kind === 'listening';

  // Collapsed state. Because the overlay window has skipTaskbar=true for stealth, a
  // true OS-level minimize leaves it unreachable. Instead we collapse the window to a
  // thin header-only strip that keeps the buttons clickable. Click the collapse button
  // again to expand.
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapse = async () => {
    if (!window.ic) return;
    if (collapsed) {
      await window.ic.expandOverlay?.();
      setCollapsed(false);
    } else {
      await window.ic.minimizeOverlay?.();
      setCollapsed(true);
    }
  };

  // Brief toast for feedback when the user clicks Analyze (or hits Ctrl+Shift+C).
  // Without this the user couldn't tell the keystroke did anything until the answer
  // started streaming — which looks like a dead button.
  const [analyzeToast, setAnalyzeToast] = useState<string | null>(null);
  const analyze = async () => {
    const api = window.ic;
    if (!api) return;
    setAnalyzeToast('Analyzing screen\u2026');
    try {
      const r = await api.captureScreenshot();
      if (!r.ok) {
        setAnalyzeToast(r.error ?? 'Capture failed.');
      } else {
        setAnalyzeToast(`Sent ${Math.round((r.bytes ?? 0) / 1024)} KB screenshot — waiting for OCR\u2026`);
      }
    } catch (err) {
      setAnalyzeToast(err instanceof Error ? err.message : 'Capture failed.');
    }
    setTimeout(() => setAnalyzeToast(null), 4_000);
  };

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
        className="flex h-9 shrink-0 items-center justify-between border-b border-overlay-border px-2 text-[11px] uppercase tracking-wider text-overlay-dim"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 pl-1">
          <span>copilot</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] normal-case tracking-normal ${
              listening
                ? 'bg-overlay-accent/15 text-overlay-accent'
                : connected
                  ? 'bg-white/5 text-overlay-dim'
                  : 'bg-red-500/15 text-red-300'
            }`}
          >
            {listening ? 'listening' : connected ? 'idle' : 'disconnected'}
          </span>
        </div>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <HeaderButton
            onClick={() => void window.ic?.toggleListening?.()}
            title={listening ? 'Stop listening (Ctrl+Shift+S)' : 'Start listening (Ctrl+Shift+S)'}
            emphasis={listening ? 'on' : 'off'}
          >
            {listening ? '⏸ Stop' : '▶ Listen'}
          </HeaderButton>
          <HeaderButton onClick={() => void analyze()} title="Analyze screen (Ctrl+Shift+C)">
            ⎙ Analyze
          </HeaderButton>
          <HeaderButton
            onClick={() => void toggleCollapse()}
            title={collapsed ? 'Expand' : 'Collapse to header only — ▶ Listen / ⎙ Analyze stay clickable'}
          >
            {collapsed ? '▢' : '—'}
          </HeaderButton>
          {/*
           * Intentionally NO `×` close button. skipTaskbar=true means a hidden overlay
           * has no entry anywhere — clicking × made the window permanently unreachable.
           * Users who want out-of-the-way: use the — collapse button above. Users who
           * want to fully quit: tray icon → Quit. Users who accidentally lose the window:
           * click the tray icon and it comes back.
           */}
        </div>
      </header>
      <main className={`flex min-h-0 flex-1 flex-col overflow-hidden ${collapsed ? 'hidden' : ''}`}>
        <RmsBar />
        <TranscriptPane />
        <AnswerPane />
        {sessionEvent?.kind === 'error' && 'message' in sessionEvent && (
          <div className="flex items-start gap-2 border-t border-overlay-border bg-red-500/10 px-4 py-2 text-[11px] text-red-300">
            <span className="shrink-0">⚠</span>
            <span className="min-w-0 flex-1">{sessionEvent.message}</span>
          </div>
        )}
        {analyzeToast && (
          <div className="flex items-center justify-center border-t border-overlay-border bg-overlay-accent/10 px-4 py-2 text-[11px] text-overlay-accent">
            {analyzeToast}
          </div>
        )}
        {!listening && !analyzeToast && (
          <div className="flex items-center justify-center gap-2 border-t border-overlay-border bg-white/[0.02] px-4 py-2 text-[11px] text-overlay-dim">
            <span>Click ▶ Listen above to start, then ⎙ Analyze to capture the screen.</span>
          </div>
        )}
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
      </main>
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  title,
  emphasis,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly title: string;
  readonly emphasis?: 'on' | 'off';
}) {
  const base =
    'rounded border border-overlay-border px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal';
  const tone =
    emphasis === 'on'
      ? 'bg-overlay-accent/20 text-overlay-accent hover:bg-overlay-accent/30'
      : 'bg-white/5 text-overlay-text hover:bg-white/10';
  return (
    <button type="button" onClick={onClick} title={title} className={`${base} ${tone}`}>
      {children}
    </button>
  );
}
