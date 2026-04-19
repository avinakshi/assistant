'use client';

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Props {
  readonly title: string;
  readonly storageKey: string;
  readonly initial: Rect;
  readonly children: ReactNode;
}

const MIN_W = 260;
const MIN_H = 160;

function loadRect(key: string, fallback: Rect): Rect {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    // localStorage is our own sandboxed per-origin storage, not an external trust
    // boundary — a Zod parse here is overkill. The try/catch + runtime shape check
    // below is the actual guardrail.
    // eslint-disable-next-line no-restricted-syntax
    const parsed = JSON.parse(raw) as Partial<Rect>;
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return {
        x: parsed.x,
        y: parsed.y,
        width: Math.max(MIN_W, parsed.width),
        height: Math.max(MIN_H, parsed.height),
      };
    }
  } catch {
    /* corrupted entry — fall through to default */
  }
  return fallback;
}

/**
 * Floating pane for the /app/live canvas. Dragged from its title bar; resized from the
 * bottom-right grip. Position + size are persisted per `storageKey` in localStorage so
 * the user's layout sticks across sessions. Clamped to viewport on mount so a pane that
 * was saved off-screen (e.g. after a monitor change) is always reachable.
 */
export function DraggablePane({ title, storageKey, initial, children }: Props) {
  const [rect, setRect] = useState<Rect>(initial);
  const [hydrated, setHydrated] = useState(false);
  const dragState = useRef<
    | { mode: 'move'; pointerId: number; offsetX: number; offsetY: number }
    | { mode: 'resize'; pointerId: number; startW: number; startH: number; startX: number; startY: number }
    | null
  >(null);

  useEffect(() => {
    const loaded = loadRect(storageKey, initial);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setRect({
      x: Math.min(Math.max(0, loaded.x), Math.max(0, vw - 80)),
      y: Math.min(Math.max(0, loaded.y), Math.max(0, vh - 40)),
      width: Math.min(loaded.width, Math.max(MIN_W, vw - 16)),
      height: Math.min(loaded.height, Math.max(MIN_H, vh - 16)),
    });
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(rect));
    } catch {
      /* quota or disabled storage — non-fatal */
    }
  }, [rect, storageKey, hydrated]);

  const onHeaderPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      mode: 'move',
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.x,
      offsetY: e.clientY - rect.y,
    };
  };

  const onResizePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      mode: 'resize',
      pointerId: e.pointerId,
      startW: rect.width,
      startH: rect.height,
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = dragState.current;
    if (!s || s.pointerId !== e.pointerId) return;
    if (s.mode === 'move') {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setRect((r) => ({
        ...r,
        x: Math.min(Math.max(0, e.clientX - s.offsetX), Math.max(0, vw - 80)),
        y: Math.min(Math.max(0, e.clientY - s.offsetY), Math.max(0, vh - 40)),
      }));
    } else {
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      setRect((r) => ({
        ...r,
        width: Math.max(MIN_W, s.startW + dx),
        height: Math.max(MIN_H, s.startH + dy),
      }));
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = dragState.current;
    if (s && s.pointerId === e.pointerId) {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      dragState.current = null;
    }
  };

  return (
    <div
      className="absolute rounded-xl border border-white/10 bg-ink-900/70 shadow-2xl backdrop-blur-md"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        visibility: hydrated ? 'visible' : 'hidden',
      }}
      role="group"
      aria-label={title}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex cursor-move select-none items-center justify-between rounded-t-xl border-b border-white/5 bg-white/5 px-3 py-1.5"
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
          {title}
        </div>
        <div className="text-[10px] text-white/40">drag</div>
      </div>
      <div className="h-[calc(100%-56px)] overflow-auto px-3 py-2 text-sm text-white/90">
        {children}
      </div>
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        aria-label={`Resize ${title}`}
        role="separator"
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-white/40">
          <path d="M2 14 L14 2 M6 14 L14 6 M10 14 L14 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  );
}
