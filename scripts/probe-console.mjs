// Dump the overlay's console / runtime exceptions.
const listRes = await fetch('http://localhost:9222/json');
const targets = await listRes.json();
const overlay = targets.find((t) => t.url.endsWith('/overlay/index.html'));
if (!overlay) {
  console.error('no overlay target');
  process.exit(1);
}

const ws = new WebSocket(overlay.webSocketDebuggerUrl);
await new Promise((r, rj) => {
  ws.addEventListener('open', () => r(), { once: true });
  ws.addEventListener('error', (e) => rj(e.error), { once: true });
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
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    console.log(`[${e.source}/${e.level}] ${e.text}${e.url ? ` @ ${e.url}` : ''}`);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const args = msg.params.args.map((a) => a.value ?? a.description ?? '?').join(' ');
    console.log(`[console.${msg.params.type}] ${args}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log(`[EXCEPTION] ${JSON.stringify(msg.params.exceptionDetails, null, 2)}`);
  }
});

await call('Log.enable');
await call('Runtime.enable');
// Force the page to re-send any cached log entries.
await call('Log.startViolationsReport', { config: [] }).catch(() => {});
// Wait briefly for any buffered messages.
await new Promise((r) => setTimeout(r, 1200));
ws.close();
