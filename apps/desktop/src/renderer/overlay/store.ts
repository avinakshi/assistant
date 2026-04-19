import { create } from 'zustand';
import type {
  AnswerCanceledPayload,
  AnswerDeltaPayload,
  AnswerDonePayload,
  AnswerStartPayload,
  EchoStatsPayload,
  SessionEventPayload,
  TranscriptFinalPayload,
  TranscriptPartialPayload,
  UpdaterStatePayload,
} from '../../shared/ipc-contract';

export interface TranscriptFinalEntry {
  readonly id: string;
  readonly text: string;
  readonly ts: number;
  readonly isQuestion: boolean;
}

export interface ActiveAnswer {
  readonly answerId: string;
  readonly provider: string;
  readonly mode?: string;
  readonly text: string;
  readonly isDone: boolean;
  readonly isCanceled: boolean;
  readonly latencyMs?: number;
}

interface OverlayState {
  connected: boolean;
  latestStats: EchoStatsPayload | null;
  transcriptPartial: string;
  transcriptFinals: TranscriptFinalEntry[];
  sessionEvent: SessionEventPayload | null;
  activeAnswer: ActiveAnswer | null;
  answerHistory: ActiveAnswer[];
  updater: UpdaterStatePayload | null;
  setConnected: (v: boolean) => void;
  pushStats: (s: EchoStatsPayload) => void;
  pushPartial: (p: TranscriptPartialPayload) => void;
  pushFinal: (p: TranscriptFinalPayload) => void;
  pushSessionEvent: (e: SessionEventPayload) => void;
  answerStart: (e: AnswerStartPayload) => void;
  answerDelta: (e: AnswerDeltaPayload) => void;
  answerDone: (e: AnswerDonePayload) => void;
  answerCanceled: (e: AnswerCanceledPayload) => void;
  pushUpdater: (e: UpdaterStatePayload) => void;
}

const MAX_FINALS = 20;
const MAX_HISTORY = 10;

export const useOverlayStore = create<OverlayState>((set) => ({
  connected: false,
  latestStats: null,
  transcriptPartial: '',
  transcriptFinals: [],
  sessionEvent: null,
  activeAnswer: null,
  answerHistory: [],
  updater: null,

  setConnected: (connected) => set({ connected }),
  // Any event from the main process proves the IPC bridge is alive. In session mode
  // (our real product flow) echo.stats never fires, so relying solely on pushStats
  // left the overlay stuck at "disconnected". Every incoming event now flips the flag.
  pushStats: (latestStats) => set({ connected: true, latestStats }),
  pushPartial: (p) => set({ connected: true, transcriptPartial: p.text }),
  pushFinal: (p) =>
    set((s) => ({
      connected: true,
      transcriptPartial: '',
      transcriptFinals: [
        ...s.transcriptFinals.slice(-(MAX_FINALS - 1)),
        {
          id: `${p.ts}-${s.transcriptFinals.length}`,
          text: p.text,
          ts: p.ts,
          isQuestion: p.isQuestion,
        },
      ],
    })),
  pushSessionEvent: (sessionEvent) => set({ connected: true, sessionEvent }),
  answerStart: (e) =>
    set((s) => {
      // If a prior answer was still active when a new one starts, move it to history so
      // the UI can show what was superseded.
      const historyPush: ActiveAnswer[] = s.activeAnswer
        ? [...s.answerHistory.slice(-(MAX_HISTORY - 1)), s.activeAnswer]
        : s.answerHistory;
      const next: ActiveAnswer = {
        answerId: e.answerId,
        provider: e.provider,
        text: '',
        isDone: false,
        isCanceled: false,
        ...(e.mode ? { mode: e.mode } : {}),
      };
      return { answerHistory: historyPush, activeAnswer: next };
    }),
  answerDelta: (e) =>
    set((s) => {
      if (!s.activeAnswer || s.activeAnswer.answerId !== e.answerId) return s;
      return { activeAnswer: { ...s.activeAnswer, text: s.activeAnswer.text + e.text } };
    }),
  answerDone: (e) =>
    set((s) => {
      if (!s.activeAnswer || s.activeAnswer.answerId !== e.answerId) return s;
      return {
        activeAnswer: { ...s.activeAnswer, isDone: true, latencyMs: e.latencyMs },
      };
    }),
  answerCanceled: (e) =>
    set((s) => {
      if (!s.activeAnswer || s.activeAnswer.answerId !== e.answerId) return s;
      return { activeAnswer: { ...s.activeAnswer, isCanceled: true } };
    }),
  pushUpdater: (updater) => set({ updater }),
}));
