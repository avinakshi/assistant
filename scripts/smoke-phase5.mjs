// Automated Phase 5 end-to-end smoke.
//
// 1. Open https://leetcode.com/problems/two-sum/ in the user's default browser.
// 2. Wait a few seconds for the page to paint.
// 3. Attach to the overlay via Chrome DevTools Protocol.
// 4. Invoke window.ic.captureScreenshot() — triggers the native BitBlt + WS upload.
// 5. Poll the overlay DOM for the OCR'd title/problem and the streamed coding answer.
//
// Assumes api + electron are already running:
//   - api: pnpm --filter @repo/api dev (with .env sourced)
//   - electron: AUDIO_SOURCE=native WS_ROUTE=session ./node_modules/.bin/electron
//     --remote-debugging-port=9222 dist/main/index.js
//
// Uses only built-ins + Node's WebSocket (Node 24).

import { spawn } from 'node:child_process';

const LEETCODE_URL = 'https://leetcode.com/problems/two-sum/';
const CDP_JSON = 'http://localhost:9222/json';

function openInBrowser(url) {
  const proc = spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' });
  proc.unref();
}

async function findOverlayTarget() {
  const res = await fetch(CDP_JSON);
  const list = await res.json();
  return list.find((t) => t.url.endsWith('/overlay/index.html'));
}

async function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, rj) => {
    ws.addEventListener('open', () => r(), { once: true });
    ws.addEventListener('error', (e) => rj(e.error ?? new Error('ws error')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  return {
    send,
    close: () => ws.close(),
  };
}

async function evalInOverlay(cdp, expr, returnByValue = true) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(`eval threw: ${JSON.stringify(r.exceptionDetails, null, 2)}`);
  }
  return r.result?.value;
}

async function probeOverlay(cdp) {
  return evalInOverlay(
    cdp,
    `
    (() => {
      const finals = Array.from(document.querySelectorAll('[data-testid="transcript-final"]'));
      const answerEl = document.querySelector('[data-testid="answer-text"]');
      const answerPane = document.querySelector('[data-testid="answer-pane"]');
      return JSON.stringify({
        finalsCount: finals.length,
        answerText: answerEl?.textContent ?? null,
        answerLen: answerEl?.textContent?.length ?? 0,
        answerPaneHeader: answerPane?.querySelector('span.font-mono')?.textContent ?? null,
      });
    })()
  `,
  ).then((s) => JSON.parse(s));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== Phase 5 automated smoke ===');
  const overlay = await findOverlayTarget();
  if (!overlay) {
    console.error('no overlay target — is Electron running with --remote-debugging-port=9222?');
    process.exit(1);
  }
  const cdp = await openCdp(overlay.webSocketDebuggerUrl);

  console.log(`[0.0s] opening ${LEETCODE_URL} in default browser`);
  openInBrowser(LEETCODE_URL);

  // Give Chrome a chance to load LeetCode. 8 s is generous for first-launch; faster on a
  // warm browser. Adjust upward if the probe shows the answer referencing an unrelated page.
  console.log('[1.0s] waiting 10s for page load');
  await sleep(10_000);

  console.log('[11s] invoking window.ic.captureScreenshot()');
  const captureResult = await evalInOverlay(
    cdp,
    `window.ic.captureScreenshot().then(JSON.stringify)`,
  );
  console.log('[11s] capture result:', captureResult);

  // Wait for OCR → LLM round-trip. Gemini flash-lite ~1s TTFT, answers typically done
  // within 10s. Poll DOM every second and report the first time an answer arrives.
  let finalProbe = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const p = await probeOverlay(cdp);
    if (p.answerLen > 50) {
      finalProbe = p;
      console.log(`[${Math.round((Date.now() - deadline + 30_000) / 1000)}s] answer received (${p.answerLen} chars)`);
      // Let it keep streaming for a few more seconds to get a representative sample.
      await sleep(4000);
      break;
    }
  }

  const finalState = await probeOverlay(cdp);
  console.log('\n=== final overlay state ===');
  console.log(`transcript finals: ${finalState.finalsCount}`);
  console.log(`answer header    : ${finalState.answerPaneHeader}`);
  console.log(`answer length    : ${finalState.answerLen} chars`);
  if (finalState.answerText) {
    const preview = finalState.answerText.slice(0, 500);
    console.log('\n--- answer preview (first 500 chars) ---');
    console.log(preview);
    console.log('---');
  }

  cdp.close();
  if (finalProbe) {
    console.log('\nPhase 5 smoke: PASS');
    process.exit(0);
  }
  console.log('\nPhase 5 smoke: FAIL — no answer received within 30s');
  process.exit(2);
}

await main();
