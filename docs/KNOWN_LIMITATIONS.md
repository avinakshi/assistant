# Known Limitations

Tracked disclosures — things the product does not guarantee and users should know about.
Referenced from ToS, support docs, and the Phase 2 stealth test matrix.

## Stealth overlay

### Confirmed working (Windows side)
- Windows 10 build 19041+ (2004, May 2020) and Windows 11: `WDA_EXCLUDEFROMCAPTURE` applied. Overlay is truly excluded from OS-level screen capture APIs (Zoom, Teams, Meet, OBS, QuickTime, Snipping Tool, Windows Game Bar).

### Degraded modes
- **Windows 10 < build 19041**: `WDA_EXCLUDEFROMCAPTURE` unavailable; we fall back to `WDA_MONITOR`, which renders the overlay as a black rectangle in the capture. Better than visible, but breaks the illusion.
- **macOS**: depends on Electron's `setContentProtection(true)` (`NSWindow.sharingType = NSWindowSharingNone`). No ScreenCaptureKit audio implementation yet, so macOS is deferred — see Phase 1 sign-off. When Mac lands, the stealth story is covered by the same Electron API plus LSUIElement in Info.plist.

### Known bypasses (cannot fix at OS level)
- **Nvidia ShadowPlay**: captures at the GPU driver level, below the OS capture APIs. Our window may be visible in ShadowPlay recordings. Disclose in ToS.
- **AMD ReLive**: same as ShadowPlay — GPU-level capture, bypasses `WDA_EXCLUDEFROMCAPTURE`.
- **Physical camera pointed at the screen**: obvious, but worth saying.
- **Screen-reader / accessibility tools**: some use OS-level text extraction that may read our overlay content; this hasn't been tested end-to-end.

## Audio capture

- **Windows**: WASAPI loopback. Captures the default render endpoint. If the user routes audio to a different device mid-session, we reacquire (handled in Rust).
- **macOS**: deferred — no Mac dev machine during Phase 1. ScreenCaptureKit skeleton exists but is unimplemented.

## Global shortcuts

`Ctrl+Shift+H` / `Ctrl+Shift+S` / `Ctrl+Shift+Q` are claimed via Electron's `globalShortcut`. If another app already owns one of those combinations (e.g., Windows Sticky Keys, a screen-capture tool), our registration fails silently and we log a warning. Phase 6 adds user-configurable bindings.

## Performance budgets (ongoing)

- Overlay render on session start: target < 100 ms. Not yet benchmarked end-to-end.
- Audio frame loss rate: target < 0.1 %. Phase 1 stub smoke showed ~0 drops over 30 s; a 30-minute stability test is still owed (TESTING.md Phase 1 Test 5).
