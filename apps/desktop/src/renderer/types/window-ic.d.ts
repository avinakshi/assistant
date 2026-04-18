import type {
  AnswerCanceledPayload,
  AnswerDeltaPayload,
  AnswerDonePayload,
  AnswerStartPayload,
  CaptureScreenshotResult,
  EchoStatsPayload,
  OverlayVisibilityPayload,
  SessionEventPayload,
  TranscriptFinalPayload,
  TranscriptPartialPayload,
} from '../../shared/ipc-contract';

declare global {
  interface Window {
    ic?: {
      // Invokable actions (renderer → main).
      quit: () => Promise<void>;
      showOverlay: () => Promise<void>;
      hideOverlay: () => Promise<void>;
      openSettings: () => Promise<void>;
      captureScreenshot: () => Promise<CaptureScreenshotResult>;
      // Subscriptions (main → renderer). Each returns an unsubscribe fn.
      onEchoStats: (fn: (payload: EchoStatsPayload) => void) => () => void;
      onOverlayVisibility: (fn: (payload: OverlayVisibilityPayload) => void) => () => void;
      onTranscriptPartial: (fn: (payload: TranscriptPartialPayload) => void) => () => void;
      onTranscriptFinal: (fn: (payload: TranscriptFinalPayload) => void) => () => void;
      onSessionEvent: (fn: (payload: SessionEventPayload) => void) => () => void;
      onAnswerStart: (fn: (payload: AnswerStartPayload) => void) => () => void;
      onAnswerDelta: (fn: (payload: AnswerDeltaPayload) => void) => () => void;
      onAnswerDone: (fn: (payload: AnswerDonePayload) => void) => () => void;
      onAnswerCanceled: (fn: (payload: AnswerCanceledPayload) => void) => () => void;
    };
  }
}

export {};
