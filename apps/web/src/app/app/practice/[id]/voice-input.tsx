'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { VoiceClient, httpOriginToWs, type VoiceEvent } from '@/lib/practice/voice-client';

type Phase = 'idle' | 'connecting' | 'listening' | 'error';

interface Props {
  /** Called with the final accumulated transcript when the user confirms/submits. */
  onSubmit: (text: string) => void;
  /** Whether the parent is currently awaiting an answer (false disables the mic). */
  enabled: boolean;
}

/**
 * Hold-to-talk mic button. Opens a WS to /ws/practice-stt, streams PCM16 while active,
 * displays the rolling transcript. On stop, hands the final text to the parent via
 * `onSubmit`. The parent is responsible for calling the existing `answerPracticeAction`.
 *
 * Error states are handled gracefully:
 *   - No mic permission → shows a clear "mic denied" message + retry
 *   - JWT missing (user signed out in another tab) → prompts to refresh
 *   - Deepgram unavailable → falls back to an "STT unavailable — type instead" note
 */
export function VoiceInput({ onSubmit, enabled }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [partial, setPartial] = useState('');
  const [finals, setFinals] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<VoiceClient | null>(null);

  const combined = [...finals, partial].filter((s) => s.length > 0).join(' ');

  // Teardown on unmount so a page navigation doesn't leave the mic hot.
  useEffect(() => {
    return () => {
      void clientRef.current?.stop();
      clientRef.current = null;
    };
  }, []);

  const startListening = async () => {
    setError(null);
    setPhase('connecting');
    setPartial('');
    setFinals([]);

    try {
      // Grab the user's current Supabase access token. Browser-side client reads it
      // straight from the auth cookie — no server round-trip.
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const jwt = data.session?.access_token;
      if (!jwt) {
        setPhase('error');
        setError('Not signed in. Refresh the page and try again.');
        return;
      }

      const wsBase =
        process.env.NEXT_PUBLIC_API_WS_URL ??
        httpOriginToWs(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001');
      const url = `${wsBase.replace(/\/$/, '')}/ws/practice-stt?token=${encodeURIComponent(jwt)}&language=en`;

      const client = new VoiceClient({
        url,
        onEvent: (ev: VoiceEvent) => {
          if (ev.kind === 'ready') setPhase('listening');
          else if (ev.kind === 'partial') setPartial(ev.text);
          else if (ev.kind === 'final') {
            setFinals((prev) => [...prev, ev.text]);
            setPartial('');
          } else if (ev.kind === 'error') {
            setPhase('error');
            setError(ev.message);
          } else if (ev.kind === 'closed' && phase !== 'error') {
            setPhase('idle');
          }
        },
      });
      clientRef.current = client;
      await client.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPhase('error');
      if (/Permission|NotAllowed/i.test(msg)) {
        setError('Mic permission denied. Check your browser site settings and retry.');
      } else {
        setError(msg);
      }
    }
  };

  const stopAndSubmit = async () => {
    const c = clientRef.current;
    clientRef.current = null;
    if (c) await c.stop();
    setPhase('idle');
    // Wait a tick for any pending final to land, then submit.
    setTimeout(() => {
      const text = [...finals, partial].filter((s) => s.length > 0).join(' ').trim();
      if (text.length > 0) onSubmit(text);
      setFinals([]);
      setPartial('');
    }, 200);
  };

  const cancel = async () => {
    const c = clientRef.current;
    clientRef.current = null;
    if (c) await c.stop();
    setPhase('idle');
    setPartial('');
    setFinals([]);
  };

  if (!enabled) return null;

  return (
    <div className="mt-3 rounded-md border border-ink-100 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Voice answer
        </div>
        <div className="flex gap-2">
          {phase === 'idle' && (
            <button
              type="button"
              onClick={() => void startListening()}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              \uD83C\uDFA4 Start speaking
            </button>
          )}
          {phase === 'connecting' && (
            <span className="text-xs text-ink-500">Connecting…</span>
          )}
          {phase === 'listening' && (
            <>
              <button
                type="button"
                onClick={() => void cancel()}
                className="rounded-md border border-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void stopAndSubmit()}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
              >
                Stop + submit
              </button>
            </>
          )}
          {phase === 'error' && (
            <button
              type="button"
              onClick={() => void startListening()}
              className="rounded-md border border-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50"
            >
              Retry
            </button>
          )}
        </div>
      </div>
      {phase === 'listening' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-700">
          <span className="flex h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Listening… speak clearly.
        </div>
      )}
      {combined.length > 0 && (
        <p className="mt-2 max-h-32 overflow-y-auto text-sm text-ink-900 whitespace-pre-wrap">
          {combined}
        </p>
      )}
      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
