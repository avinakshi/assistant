# Interview Copilot

Real-time interview copilot. Desktop-first (Mac + Windows). Stealth overlay. Sub-900ms latency.

> **Phase status:** Phase 1 in progress — audio capture de-risk.
> Full plan in `docs/INTERVIEW-COPILOT-COMPLETE.txt` (the master document).

## Structure

```
apps/
  desktop/    Electron 32 + React (renderer lands Phase 2)
  api/        Fastify 5 (WS + REST)
  web/        Next.js 15 (lands Phase 6)
packages/
  audio-core/        Rust + napi-rs — OS audio capture, screenshot, window enum, stealth
  shared/            Zod schemas, wire protocol, shared types
  prompts/           LLM prompt packs (lands Phase 4)
  llm-router/        Claude/GPT/Gemini routing + racing (lands Phase 4)
  ocr/               OCR pipeline (lands Phase 5)
  question-detector/ Heuristic classifier (lands Phase 4)
  config/            Shared tsconfig, eslint, tailwind presets
docs/                Master planning doc + runbooks
```

## Prereqs

- Node 20+ (24 works; 20 LTS is prod target)
- pnpm 10+
- Rust 1.80+ (install via https://rustup.rs) — required for `packages/audio-core`
- (Mac only) Xcode CLT — `xcode-select --install`
- (Windows only) Visual Studio Build Tools with Windows 10 SDK

## Install

```bash
pnpm install
```

## Dev

```bash
pnpm dev              # all apps in parallel
pnpm --filter api dev
pnpm --filter desktop dev
```

## Test

```bash
pnpm test             # full suite
pnpm test:unit        # unit only (fast, no external deps)
pnpm test:integration # integration (uses mock WS server for STT, etc.)
```

## Quality gates (per `docs/INTERVIEW-COPILOT-COMPLETE.txt` §03 CLAUDE.md)

- TypeScript `strict` + `noUncheckedIndexedAccess` — no `any` without `// @reason:`
- Zod at every boundary (WS, REST, env, LLM tool calls, OCR)
- Vitest unit + integration; Playwright E2E (Phase 6+); WebdriverIO desktop E2E
- Electron hardening: `contextIsolation`, `nodeIntegration:false`, `sandbox:true`, CSP
- Perf budgets: STT p50 <350ms, LLM first-token p50 <600ms, E2E p50 <900ms, audio loss <0.1%
- No PII in logs — lengths, durations, token counts only

## Build state

| Subsystem | Status |
|---|---|
| Monorepo scaffold | ✅ Phase 1 |
| `apps/api` Fastify + /ws/echo | 🚧 Phase 1 |
| `apps/desktop` Electron main | 🚧 Phase 1 |
| `packages/audio-core` Windows WASAPI | 🚧 Phase 1 (needs Rust toolchain) |
| `packages/audio-core` Mac ScreenCaptureKit | ⏸ deferred — no Mac available |
| Stealth overlay | ⏳ Phase 2 |
| Deepgram STT | ⏳ Phase 3 |
| LLM router | ⏳ Phase 4 |
| Screen OCR | ⏳ Phase 5 |
| Web + billing | ⏳ Phase 6 |
