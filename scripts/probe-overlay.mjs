// Attach to the overlay's remote DevTools, evaluate the transcript DOM state, print it.
// Usage: node scripts/probe-overlay.mjs "<label>"
// Uses Node 24's global WebSocket (WHATWG API — addEventListener, not Node-ws events).

const label = process.argv[2] ?? '(unlabeled)';
const listRes = await fetch('http://localhost:9222/json');
const targets = await listRes.json();
const overlay = targets.find((t) => t.url.endsWith('/overlay/index.html'));
if (!overlay) {
  console.error('No overlay target found');
  process.exit(1);
}

const ws = new WebSocket(overlay.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', () => resolve(), { once: true });
  ws.addEventListener('error', (e) => reject(e.error ?? new Error('ws error')), { once: true });
});

let id = 0;
const pending = new Map();
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});

const expr = `
  (() => {
    const finals = Array.from(document.querySelectorAll('[data-testid="transcript-final"]'));
    const partialEl = document.querySelector('[data-testid="transcript-partial"]');
    const answerEl = document.querySelector('[data-testid="answer-text"]');
    const answerPane = document.querySelector('[data-testid="answer-pane"]');
    return JSON.stringify({
      icExists: typeof window.ic === 'object' && window.ic !== null,
      icKeys: typeof window.ic === 'object' && window.ic !== null ? Object.keys(window.ic) : [],
      finalsCount: finals.length,
      finalsText: finals.map(el => ({ text: el.textContent, isQuestion: el.dataset.isQuestion })),
      partialText: partialEl?.textContent ?? null,
      paneText: document.querySelector('[data-testid="transcript-pane"]')?.textContent ?? null,
      answerText: answerEl?.textContent ?? null,
      answerLen: answerEl?.textContent?.length ?? 0,
      answerPaneHeader: answerPane?.querySelector('span.font-mono')?.textContent ?? null,
    });
  })()
`;

const res = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(`=== ${label} ===`);
console.log(JSON.parse(res.result.value));
ws.close();
