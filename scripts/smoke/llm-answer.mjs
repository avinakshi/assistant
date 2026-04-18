// Live LLM smoke: instantiate the real LlmRouter with the real Gemini key and stream an
// answer to a canned interview question. Prints the full answer so the operator can
// judge quality.
//
// Run: node scripts/smoke/llm-answer.mjs "<question>"

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
process.chdir(repoRoot);

// Load .env from the repo root (we run from the repo root, not the package).
try {
  const envRaw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  for (const line of envRaw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* rely on whatever env is already exported */
}

const { GeminiProvider, LlmRouter } = require(
  resolve(repoRoot, 'packages/llm-router/dist/index.js'),
);

const question = process.argv[2] ?? 'Tell me about a time you had to push back on a senior engineer.';
const hint = process.argv[3] ?? 'behavioral';

const gemini = new GeminiProvider({ apiKey: process.env.GOOGLE_API_KEY });
const router = new LlmRouter({
  gemini,
  onEvent: (ev) => {
    if (ev.kind === 'banned.hit') console.error(`[banned] ${ev.offender}`);
  },
});

const start = Date.now();
let firstTokenAt = null;
let totalChars = 0;
const stream = await router.startStream({
  tier: 'free',
  llm: 'auto',
  context: {
    question,
    language: 'en',
    hint,
  },
});

console.log(`\n== Question ==\n${question}\n\n== Answer (provider: ${stream.provider}) ==`);
for await (const delta of stream.deltas) {
  if (firstTokenAt === null) firstTokenAt = Date.now();
  totalChars += delta.length;
  process.stdout.write(delta);
}
const done = Date.now();
console.log(`\n\n== Telemetry ==`);
console.log(`first token: ${firstTokenAt - start} ms`);
console.log(`total:       ${done - start} ms`);
console.log(`chars:       ${totalChars}`);
