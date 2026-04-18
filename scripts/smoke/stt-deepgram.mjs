// Live Deepgram smoke: open a real WS, send a burst of silent PCM frames, confirm the
// provider reports ready + we receive either a (near-empty) final transcript or graceful
// close. We can't feed real speech from the shell, so this proves auth + protocol only;
// the mock-backed integration test already covers the final-transcript → orchestrator
// path end-to-end.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
process.chdir(repoRoot);
const require = createRequire(import.meta.url);

try {
  const envRaw = readFileSync(resolve(repoRoot, '.env'), 'utf8');
  for (const line of envRaw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

// The Deepgram provider lives in apps/api, not a standalone package. Build it.
// We require through the built dist instead of TS source to avoid ts-node overhead.
const { DeepgramProvider } = require(
  resolve(repoRoot, 'apps/api/dist/src/providers/stt/deepgram.js'),
);

const started = Date.now();
const events = [];
const dg = new DeepgramProvider({ apiKey: process.env.DEEPGRAM_API_KEY });

const session = await dg.connect({
  language: 'en',
  sampleRateHz: 16_000,
  onPartial: (text, ts) => events.push({ t: 'partial', text, ts, at: Date.now() - started }),
  onFinal: (text, ts) => events.push({ t: 'final', text, ts, at: Date.now() - started }),
  onError: (err) => events.push({ t: 'error', code: err.code, message: err.message, at: Date.now() - started }),
  onClose: (reason) => events.push({ t: 'close', reason, at: Date.now() - started }),
});
console.log(`connect: ${Date.now() - started} ms`);

// Push 1 second of silence (50 frames × 640 bytes). Deepgram usually emits a Metadata
// message + possibly a final empty transcript once VAD gates end-of-speech.
const frame = Buffer.alloc(640);
for (let i = 0; i < 50; i++) session.pushFrame(frame);

// Wait briefly for any upstream events to land.
await new Promise((r) => setTimeout(r, 2_000));
await session.close();
await new Promise((r) => setTimeout(r, 500));

console.log('\n== Events ==');
if (events.length === 0) {
  console.log('(none — Deepgram held silence; no speech detected. Auth + handshake OK.)');
} else {
  for (const e of events) console.log(JSON.stringify(e));
}
