import { describe, expect, it } from 'vitest';
import { IpcInvokeChannels, IpcPushChannels } from './ipc-contract';

describe('ipc-contract — channel name stability', () => {
  // These names cross the process boundary. A rename without coordinated updates on both
  // sides silently breaks features. This test locks the wire names.
  it('freezes invoke channel names', () => {
    expect(IpcInvokeChannels).toEqual({
      SystemQuit: 'system:quit',
      SystemShowOverlay: 'system:show-overlay',
      SystemHideOverlay: 'system:hide-overlay',
      SystemOpenSettings: 'system:open-settings',
      SystemCaptureScreenshot: 'system:capture-screenshot',
      UpdaterCheck: 'updater:check',
      UpdaterInstall: 'updater:install',
    });
  });

  it('freezes push channel names', () => {
    expect(IpcPushChannels).toEqual({
      EchoStats: 'push:echo-stats',
      OverlayVisibility: 'push:overlay-visibility',
      TranscriptPartial: 'push:transcript-partial',
      TranscriptFinal: 'push:transcript-final',
      SessionEvent: 'push:session-event',
      AnswerStart: 'push:answer-start',
      AnswerDelta: 'push:answer-delta',
      AnswerDone: 'push:answer-done',
      AnswerCanceled: 'push:answer-canceled',
      UpdaterState: 'push:updater-state',
    });
  });

  it('every channel name is colon-namespaced, and invoke/push sets never overlap', () => {
    const invokeNames = Object.values(IpcInvokeChannels);
    const pushNames = Object.values(IpcPushChannels);
    for (const name of invokeNames) expect(name).toMatch(/^[a-z]+:/);
    for (const name of pushNames) expect(name.startsWith('push:')).toBe(true);
    for (const n of invokeNames) expect(pushNames).not.toContain(n);
  });
});
