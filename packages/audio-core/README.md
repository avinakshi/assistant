# @repo/audio-core

Native Rust addon (via napi-rs) for OS audio capture, screenshot, window enumeration, and overlay stealth.

## Build

**Prerequisite:** Rust 1.80+ via [rustup](https://rustup.rs). On Windows, also install the Visual Studio Build Tools with the Windows 10/11 SDK.

```bash
# From repo root:
pnpm --filter @repo/audio-core build       # release build → audio-core.{platform}.node
pnpm --filter @repo/audio-core build:debug # faster, unoptimized
pnpm --filter @repo/audio-core test        # cargo test (pure Rust unit tests)
pnpm --filter @repo/audio-core lint        # cargo clippy -D warnings
```

## Phase 1 status

| Target | Status |
|---|---|
| Windows WASAPI loopback | ✅ Implemented |
| macOS ScreenCaptureKit | ⏸ Skeleton only (needs Mac dev machine) |
| Resampler (48 k → 16 k mono Int16) | ✅ Implemented + unit tests |
| `AudioSession.start/stop` N-API | ✅ |
| `captureScreenshot` | ⏳ Phase 5 |
| `listMeetingWindows` | ⏳ Phase 7 |
| `applyStealth` | ⏳ Phase 2 |

## Frame contract

- 16 kHz mono linear16 PCM
- 320 samples per frame (640 bytes, 20 ms)
- 50 frames/second exactly
- Timestamps monotonically increasing (nanoseconds from capture start)

This contract is locked — matches `packages/shared/src/audio.ts` constants. Break either, break the whole pipeline.
