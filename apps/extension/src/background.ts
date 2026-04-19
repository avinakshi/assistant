/**
 * Service worker (MV3 background). No-op for v1 — kept as an entry point so we can add
 * long-lived tasks later (session refresh, context menu items, keyboard shortcuts)
 * without restructuring the manifest.
 */

chrome.runtime.onInstalled.addListener(() => {
  // First install / upgrade hook. Currently we just log so the extension shows up in
  // chrome://extensions > service-worker console, making "did it load?" obvious.
  console.log('[interview-copilot] extension installed / updated');
});

export {};
