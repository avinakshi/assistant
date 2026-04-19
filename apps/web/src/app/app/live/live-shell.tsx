'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { LiveClient, LiveClientError, type LiveServerEvent } from '@/lib/live/live-client';
import { DraggablePane } from './draggable-pane';

type Phase = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

type GapState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready';
      cached: boolean;
      analysis: {
        matches: string[];
        gaps: string[];
        likelyQuestions: string[];
        talkingPoints: string[];
      };
    }
  | { kind: 'error'; message: string };

interface AnswerView {
  readonly answerId: string;
  readonly provider: string;
  readonly mode?: string;
  text: string;
  done: boolean;
  latencyMs?: number;
}

interface LiveSessionShellProps {
  readonly wsUrl: string;
  readonly resumes?: readonly { id: string; name: string; is_default: boolean }[];
  readonly jds?: readonly { id: string; title: string }[];
}

export function LiveSessionShell({ wsUrl, resumes = [], jds = [] }: LiveSessionShellProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  const [partialSource, setPartialSource] = useState<'interviewer' | 'candidate'>('interviewer');
  const [finals, setFinals] = useState<
    { text: string; isQuestion: boolean; source: 'interviewer' | 'candidate'; ts: number }[]
  >([]);
  const [answers, setAnswers] = useState<AnswerView[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [hint, setHint] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  // Pre-start config. `resumeId` defaults to the user's default resume when one exists.
  const defaultResumeId = resumes.find((r) => r.is_default)?.id ?? resumes[0]?.id ?? '';
  const [resumeId, setResumeId] = useState<string>(defaultResumeId);
  const [jdId, setJdId] = useState<string>('');
  const [extraInstructions, setExtraInstructions] = useState('');
  const [simpleEnglish, setSimpleEnglish] = useState(false);
  const [gap, setGap] = useState<GapState>({ kind: 'idle' });
  const clientRef = useRef<LiveClient | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

  // Phase 13e: when both resume + JD are picked, fetch the cached gap analysis. Cheap
  // when cached; ~2-5 s to generate on miss. We fire this in a useEffect keyed on both
  // ids so changing either picker re-runs it.
  useEffect(() => {
    if (!resumeId || !jdId) {
      setGap({ kind: 'idle' });
      return;
    }
    const ac = new AbortController();
    setGap({ kind: 'loading' });
    void (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setGap({ kind: 'error', message: 'Signed out — refresh to log back in.' });
          return;
        }
        const res = await fetch(`${apiBase}/api/jd-resume-gap`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ resumeId, jdId }),
          signal: ac.signal,
        });
        if (!res.ok) {
          setGap({ kind: 'error', message: `HTTP ${res.status}` });
          return;
        }
        const body = (await res.json()) as {
          cached: boolean;
          analysis: {
            matches: string[];
            gaps: string[];
            likelyQuestions: string[];
            talkingPoints: string[];
          };
        };
        setGap({ kind: 'ready', ...body });
      } catch (err) {
        if (ac.signal.aborted) return;
        setGap({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => ac.abort();
  }, [resumeId, jdId, apiBase]);

  const handleEvent = useCallback((ev: LiveServerEvent) => {
    if (ev.kind === 'ready') {
      setPhase('live');
    } else if (ev.kind === 'transcript.partial') {
      setPartial(ev.text);
      setPartialSource(ev.source);
    } else if (ev.kind === 'transcript.final') {
      setPartial('');
      setFinals((prev) => [
        ...prev.slice(-30),
        { text: ev.text, isQuestion: ev.isQuestion, source: ev.source, ts: ev.ts },
      ]);
    } else if (ev.kind === 'answer.start') {
      setAnswers((prev) => [
        ...prev.slice(-8),
        {
          answerId: ev.answerId,
          provider: ev.provider,
          ...(ev.mode ? { mode: ev.mode } : {}),
          text: '',
          done: false,
        },
      ]);
    } else if (ev.kind === 'answer.delta') {
      setAnswers((prev) =>
        prev.map((a) => (a.answerId === ev.answerId ? { ...a, text: a.text + ev.text } : a)),
      );
    } else if (ev.kind === 'answer.done') {
      setAnswers((prev) =>
        prev.map((a) =>
          a.answerId === ev.answerId ? { ...a, done: true, latencyMs: ev.latencyMs } : a,
        ),
      );
    } else if (ev.kind === 'answer.canceled') {
      setAnswers((prev) => prev.filter((a) => a.answerId !== ev.answerId));
    } else if (ev.kind === 'error') {
      setError(`${ev.code}: ${ev.message}`);
      setPhase('error');
    } else if (ev.kind === 'closed') {
      setPhase((p) => (p === 'error' ? p : 'ended'));
    }
  }, []);

  const [micOnlyMode, setMicOnlyMode] = useState(false);

  const start = async (mode: 'screen' | 'mic-only' = 'screen') => {
    setError(null);
    setPhase('connecting');
    setMicOnlyMode(mode === 'mic-only');
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setPhase('error');
        setError('Not signed in. Refresh and sign in again.');
        return;
      }
      const client = new LiveClient({
        wsUrl,
        token,
        language: 'en',
        mode: 'auto',
        llm: 'auto',
        persistTranscripts: true,
        ...(resumeId ? { resumeId } : {}),
        ...(jdId ? { jdId } : {}),
        ...(extraInstructions.trim() ? { extraInstructions: extraInstructions.trim() } : {}),
        ...(simpleEnglish ? { simpleEnglish: true } : {}),
        onEvent: handleEvent,
      });
      clientRef.current = client;
      if (mode === 'mic-only') {
        // In mic-only mode the candidate's own voice is the only transcribed source —
        // show the mic as "on" immediately so the toolbar toggle reflects reality.
        setMicOn(true);
        await client.startMicOnly();
      } else {
        await client.start();
      }
    } catch (err) {
      const msg =
        err instanceof LiveClientError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase('error');
    }
  };

  const stop = async () => {
    const c = clientRef.current;
    clientRef.current = null;
    if (c) await c.stop();
    setPhase('ended');
  };

  const toggleMic = async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      if (micOn) {
        await c.disableMic();
        setMicOn(false);
      } else {
        await c.enableMic();
        setMicOn(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendHint = () => {
    const c = clientRef.current;
    if (!c || hint.trim().length === 0) return;
    c.sendHint(hint);
    setHint('');
  };

  const analyzeScreen = async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      await c.captureScreenshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    return () => {
      void clientRef.current?.stop();
      clientRef.current = null;
    };
  }, []);

  // ? toggles help
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t?.isContentEditable ?? false);
      if (e.key === '?' && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowHelp((v) => !v);
      } else if (e.key === 'Escape') {
        setShowHelp(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative min-h-screen text-white">
      {/* Top toolbar */}
      <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/60 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold">Interview Copilot · Live</div>
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wider ${
              phase === 'live'
                ? 'bg-emerald-500/20 text-emerald-300'
                : phase === 'error'
                  ? 'bg-red-500/20 text-red-300'
                  : phase === 'connecting'
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-white/10 text-white/60'
            }`}
          >
            {phase}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {phase === 'idle' || phase === 'ended' || phase === 'error' ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void start('screen')}
                className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-brand-400"
              >
                Start session
              </button>
              <button
                type="button"
                onClick={() => void start('mic-only')}
                className="rounded border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-brand-400"
              >
                Mic only
              </button>
            </div>
          ) : (
            <>
              {!micOnlyMode && (
                <button
                  type="button"
                  onClick={() => void toggleMic()}
                  className={`rounded px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-400 ${
                    micOn
                      ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                      : 'bg-white/10 text-white/80 hover:bg-white/20'
                  }`}
                >
                  {micOn ? '\uD83D\uDD34 Mic on' : '\uD83C\uDFA4 Enable mic'}
                </button>
              )}
              {!micOnlyMode && (
                <button
                  type="button"
                  onClick={() => void analyzeScreen()}
                  className="rounded bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/20"
                >
                  Analyze screen
                </button>
              )}
              <button
                type="button"
                onClick={() => void stop()}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                End session
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            aria-controls="live-shortcuts"
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/60 hover:bg-white/10"
          >
            Shortcuts <kbd className="ml-1 rounded bg-white/10 px-1 font-mono">?</kbd>
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {phase === 'idle' && (
        <div className="mx-auto mt-20 max-w-xl rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <h1 className="text-2xl font-semibold">Browser live mode</h1>
          <p className="mt-3 text-sm text-white/70">
            Click <strong>Start session</strong>, pick the meeting tab / window / screen in the share
            picker, and turn on <em>&ldquo;Share tab audio&rdquo;</em> (Chrome) or
            <em>&ldquo;Share with audio&rdquo;</em> (Edge/Brave/Arc). No install, nothing to download.
          </p>
          <div className="mt-5 grid gap-2 text-left text-xs text-white/60">
            <div>
              • <strong>Tab share</strong> (recommended): pick the Zoom/Meet/Teams tab itself — only that tab’s audio is captured.
            </div>
            <div>
              • <strong>Window/screen share</strong>: works when the meeting runs outside the browser.
            </div>
            <div>
              • Turn on the mic only if you want your own speech transcribed (used in the post-session review).
            </div>
          </div>

          <div className="mt-6 grid gap-3 text-left">
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/60">
              Resume
              <select
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-sm font-normal normal-case text-white outline-none focus:border-brand-400"
              >
                <option value="">— none —</option>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/60">
              Job description
              <select
                value={jdId}
                onChange={(e) => setJdId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-sm font-normal normal-case text-white outline-none focus:border-brand-400"
              >
                <option value="">— none —</option>
                {jds.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-black/20 p-2.5">
              <input
                type="checkbox"
                checked={simpleEnglish}
                onChange={(e) => setSimpleEnglish(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-500"
              />
              <span className="text-left">
                <span className="block text-xs font-semibold uppercase tracking-wider text-white/80">
                  Simple English
                </span>
                <span className="mt-0.5 block text-[11px] font-normal normal-case text-white/50">
                  Short sentences, common words (CEFR A2–B1), no idioms. For non-native speakers who want to deliver the answer naturally.
                </span>
              </span>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/60">
              Extra instructions (optional)
              <textarea
                value={extraInstructions}
                onChange={(e) => setExtraInstructions(e.target.value.slice(0, 2_000))}
                rows={3}
                placeholder="e.g. Emphasize leadership examples • Target Google L6 • Answer in Hindi"
                className="mt-1 block w-full resize-none rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm font-normal normal-case text-white placeholder-white/30 outline-none focus:border-brand-400"
              />
              <div className="mt-0.5 text-[10px] font-normal normal-case text-white/40">
                {extraInstructions.length}/2000
              </div>
            </label>
          </div>

          {(gap.kind === 'loading' || gap.kind === 'ready' || gap.kind === 'error') && (
            <div className="mt-6 rounded-lg border border-white/10 bg-black/30 p-4 text-left">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-white/60">
                  Fit analysis
                </div>
                {gap.kind === 'ready' && gap.cached && (
                  <span className="text-[10px] text-white/40">cached</span>
                )}
              </div>
              {gap.kind === 'loading' && (
                <div className="mt-2 text-xs text-white/50">Analyzing resume vs JD…</div>
              )}
              {gap.kind === 'error' && (
                <div className="mt-2 text-xs text-red-300">{gap.message}</div>
              )}
              {gap.kind === 'ready' && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {gap.analysis.matches.length > 0 && (
                    <GapList
                      title="Strong matches"
                      items={gap.analysis.matches}
                      tone="emerald"
                    />
                  )}
                  {gap.analysis.gaps.length > 0 && (
                    <GapList title="Gaps to defend" items={gap.analysis.gaps} tone="amber" />
                  )}
                  {gap.analysis.likelyQuestions.length > 0 && (
                    <GapList
                      title="Likely probes"
                      items={gap.analysis.likelyQuestions}
                      tone="sky"
                    />
                  )}
                  {gap.analysis.talkingPoints.length > 0 && (
                    <GapList
                      title="Bridging framings"
                      items={gap.analysis.talkingPoints}
                      tone="violet"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void start('screen')}
              className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Start session
            </button>
            <button
              type="button"
              onClick={() => void start('mic-only')}
              className="rounded-md border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10"
              title="Skip screen share — transcribe only your mic"
            >
              Mic only
            </button>
          </div>
          <div className="mt-2 text-[11px] text-white/40">
            Use <strong>Mic only</strong> if the interview is on a phone call or another device and you just want your own voice transcribed.
          </div>
        </div>
      )}

      {(phase === 'live' || phase === 'connecting') && (
        <div className="relative h-[calc(100vh-49px)] w-full">
          {/* Transcript pane — top-left by default. */}
          <DraggablePane
            title="Transcript"
            storageKey="live-transcript"
            initial={{ x: 24, y: 16, width: 380, height: 260 }}
          >
            <div className="flex h-full flex-col overflow-hidden">
              <ol className="flex-1 overflow-y-auto text-sm">
                {finals.map((f, i) => (
                  <li
                    key={i}
                    className={`mb-1.5 flex items-start gap-2 ${
                      f.isQuestion ? 'text-brand-300' : 'text-white/80'
                    }`}
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                        f.source === 'candidate'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-sky-500/15 text-sky-300'
                      }`}
                    >
                      {f.source === 'candidate' ? 'You' : 'Them'}
                    </span>
                    <span className="flex-1">{f.text}</span>
                  </li>
                ))}
                {partial && (
                  <li className="flex items-start gap-2 italic text-white/40">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                        partialSource === 'candidate'
                          ? 'bg-emerald-500/10 text-emerald-200/80'
                          : 'bg-sky-500/10 text-sky-200/80'
                      }`}
                    >
                      {partialSource === 'candidate' ? 'You' : 'Them'}
                    </span>
                    <span>{partial}…</span>
                  </li>
                )}
                {finals.length === 0 && !partial && (
                  <li className="italic text-white/40">Listening… speak into the shared tab.</li>
                )}
              </ol>
            </div>
          </DraggablePane>

          {/* Answer pane — top-right by default. Sized to stay usable as it grows. */}
          <DraggablePane
            title="AI answer"
            storageKey="live-answer"
            initial={{ x: 420, y: 16, width: 460, height: 420 }}
          >
            <div className="flex h-full flex-col overflow-hidden">
              {answers.length === 0 ? (
                <div className="text-sm italic text-white/40">
                  Waiting for an interviewer question…
                </div>
              ) : (
                <div className="flex flex-col gap-3 overflow-y-auto">
                  {answers.map((a) => (
                    <div key={a.answerId} className="rounded bg-white/5 p-3">
                      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/50">
                        <span>{a.provider}</span>
                        {a.mode && <span>· {a.mode}</span>}
                        {a.done && a.latencyMs !== undefined && (
                          <span>· {a.latencyMs} ms</span>
                        )}
                        {!a.done && <span className="text-amber-300">streaming…</span>}
                      </div>
                      <div className="whitespace-pre-wrap text-sm text-white/90">{a.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DraggablePane>

          {/* Hint input — bottom-left. Sends a type-in question to the LLM immediately. */}
          <DraggablePane
            title="Type a hint"
            storageKey="live-hint"
            initial={{ x: 24, y: 290, width: 380, height: 140 }}
          >
            <div className="flex h-full flex-col gap-2">
              <label htmlFor="live-hint-input" className="sr-only">
                Type a hint for the AI
              </label>
              <textarea
                id="live-hint-input"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    sendHint();
                  }
                }}
                placeholder="If the transcription missed the question, type it here..."
                rows={3}
                className="w-full resize-none rounded bg-white/5 p-2 text-sm text-white placeholder:text-white/30 focus:bg-white/10 focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/40">Ctrl/Cmd + Enter to send</span>
                <button
                  type="button"
                  onClick={sendHint}
                  disabled={hint.trim().length === 0}
                  className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </DraggablePane>
        </div>
      )}

      {phase === 'ended' && (
        <div className="mx-auto mt-20 max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <div className="text-lg font-semibold">Session ended</div>
          <p className="mt-2 text-sm text-white/70">
            Your session is saved under <Link href="/app/sessions" className="text-brand-300 hover:underline">/app/sessions</Link>.
          </p>
          <button
            type="button"
            onClick={() => {
              setFinals([]);
              setAnswers([]);
              setPartial('');
              setError(null);
              setPhase('idle');
            }}
            className="mt-4 rounded-md bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
          >
            Start another session
          </button>
        </div>
      )}

      {showHelp && (
        <div
          id="live-shortcuts"
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="fixed right-4 top-16 z-50 w-64 rounded-lg border border-white/10 bg-ink-900/95 p-4 text-xs shadow-xl"
        >
          <div className="text-sm font-semibold">Keyboard shortcuts</div>
          <ul className="mt-2 flex flex-col gap-1 text-white/70">
            <li className="flex justify-between"><span>Toggle this help</span><kbd className="rounded bg-white/10 px-1">?</kbd></li>
            <li className="flex justify-between"><span>Close this help</span><kbd className="rounded bg-white/10 px-1">Esc</kbd></li>
            <li className="flex justify-between"><span>Send typed hint</span><kbd className="rounded bg-white/10 px-1">Ctrl/\u2318 + Enter</kbd></li>
          </ul>
          <div className="mt-3 text-[10px] text-white/40">
            Drag pane titles to move them. Drag the bottom-right corner to resize.
          </div>
        </div>
      )}
    </div>
  );
}

const TONE_CLASSES = {
  emerald: 'text-emerald-300 border-emerald-500/20',
  amber: 'text-amber-300 border-amber-500/20',
  sky: 'text-sky-300 border-sky-500/20',
  violet: 'text-violet-300 border-violet-500/20',
} as const;

function GapList({
  title,
  items,
  tone,
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly tone: keyof typeof TONE_CLASSES;
}) {
  const toneClass = TONE_CLASSES[tone];
  return (
    <div className={`rounded border bg-white/5 p-2.5 ${toneClass.split(' ')[1]}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-wider ${toneClass.split(' ')[0]}`}>
        {title}
      </div>
      <ul className="mt-1 space-y-1 text-[11px] text-white/80">
        {items.map((it, i) => (
          <li key={i} className="leading-snug">
            • {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
