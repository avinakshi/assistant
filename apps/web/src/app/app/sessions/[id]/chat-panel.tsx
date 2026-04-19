'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface ChatMessage {
  readonly role: 'user' | 'assistant';
  content: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'streaming'; answerStart: number }
  | { kind: 'error'; message: string };

/**
 * Post-session chat with the AI coach grounded in this session's transcript.
 *
 * The message history is kept in client state only — replays are cheap and we'd rather
 * not pay the DB write cost for every turn until users ask to save threads (Phase 13e
 * candidate). Each POST includes the prior turns so the server doesn't need to
 * reconstruct the thread.
 */
export function SessionChatPanel({ sessionId }: { readonly sessionId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, phase.kind]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const text = input.trim();
    if (!text || phase.kind === 'streaming') return;

    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setPhase({ kind: 'error', message: 'You’re signed out. Refresh to log back in.' });
      return;
    }

    const priorHistory = messages.map((m) => ({ role: m.role, content: m.content }));
    const userMessage: ChatMessage = { role: 'user', content: text };
    const assistantShell: ChatMessage = { role: 'assistant', content: '' };
    setMessages((prev) => [...prev, userMessage, assistantShell]);
    setInput('');
    setPhase({ kind: 'streaming', answerStart: Date.now() });

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`${apiBase}/api/sessions/${sessionId}/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text, history: priorHistory }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const appendDelta = (delta: string) => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = prev.slice();
          const last = next[next.length - 1]!;
          next[next.length - 1] = { ...last, content: last.content + delta };
          return next;
        });
      };
      streamLoop: for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line.length > 0) {
            try {
              // NDJSON line from our own /api/sessions/:id/chat stream. Wrapped in a
              // try/catch so malformed lines are skipped; full Zod parse would be
              // strictly better but the cost isn't worth it for a stream already auth'd
              // via the JWT header one layer up.
              // eslint-disable-next-line no-restricted-syntax
              const ev = JSON.parse(line) as { type?: string; text?: string; message?: string };
              if (ev.type === 'delta' && typeof ev.text === 'string') {
                appendDelta(ev.text);
              } else if (ev.type === 'error') {
                setPhase({ kind: 'error', message: ev.message ?? 'stream error' });
                break streamLoop;
              }
            } catch {
              /* skip malformed line */
            }
          }
          nl = buffer.indexOf('\n');
        }
      }
      setPhase((p) => (p.kind === 'error' ? p : { kind: 'idle' }));
    } catch (err) {
      if (ac.signal.aborted) {
        setPhase({ kind: 'idle' });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setPhase({ kind: 'error', message });
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink-900">Ask AI about this session</div>
          <p className="mt-0.5 text-xs text-ink-500">
            Grounded in the transcript above. Rephrase answers, draft a thank-you email,
            or ask &ldquo;what did I miss?&rdquo; to see weak spots.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              cancel();
              setMessages([]);
              setPhase({ kind: 'idle' });
            }}
            className="shrink-0 rounded border border-ink-100 px-2.5 py-1 text-xs text-ink-500 hover:bg-ink-50"
          >
            Clear
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="mt-4 flex max-h-[420px] flex-col gap-3 overflow-y-auto rounded-md border border-ink-100 bg-ink-50 p-3"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 text-xs text-ink-500">
            <div>Try:</div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  className="rounded-full border border-ink-100 bg-white px-3 py-1 text-[11px] text-ink-700 hover:border-brand-300 hover:text-brand-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 text-sm ${
              m.role === 'user'
                ? 'self-end bg-brand-600 text-white'
                : 'self-start bg-white text-ink-900 ring-1 ring-ink-100'
            }`}
            style={{ maxWidth: '85%' }}
          >
            <div className="whitespace-pre-wrap">
              {m.content || (phase.kind === 'streaming' && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
        {phase.kind === 'error' && (
          <div className="self-start rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {phase.message}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <label htmlFor="session-chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="session-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about the transcript — Enter to send, Shift+Enter for newline"
          rows={2}
          className="flex-1 resize-none rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
        {phase.kind === 'streaming' ? (
          <button
            type="button"
            onClick={cancel}
            className="shrink-0 rounded border border-ink-100 bg-white px-4 py-2 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim()}
            className="shrink-0 rounded bg-brand-600 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        )}
      </div>
    </section>
  );
}

const SUGGESTIONS = [
  'What did I miss on this question?',
  'Rewrite my last answer to be tighter.',
  'What follow-ups should I expect?',
  'Draft a 3-sentence thank-you email.',
  'Which topic should I prep more before the next round?',
];
