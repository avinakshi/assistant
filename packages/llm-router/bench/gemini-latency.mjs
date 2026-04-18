// Gemini latency probe — measures time-to-first-token across sequential calls to tell
// cold-start / model-size / prompt-size apart. No tests-at-scale; just 5 calls per config.
// Uses the same prompt context as the real session orchestrator so numbers are comparable.
//
// Run from packages/llm-router/: node bench/gemini-latency.mjs
// Env: GOOGLE_API_KEY must be set (source .env first).

import { performance } from 'node:perf_hooks';
import { GoogleGenerativeAI } from '@google/generative-ai';
// Resolve @repo/prompts from the compiled dist — this script lives alongside the package
// so local node_modules hoist picks up @google/generative-ai, but @repo/prompts is a
// workspace link we import directly from its built output.
import { BEHAVIORAL_PROMPT } from '../../prompts/dist/index.js';

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_API_KEY missing in env — source .env first');
  process.exit(1);
}

const QUESTION = 'Tell me about a time when you had to resolve a conflict between two team members.';

async function timeOne(model, label) {
  const started = performance.now();
  const client = new GoogleGenerativeAI(apiKey);
  const m = client.getGenerativeModel({ model });
  const result = await m.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: `<question>\n${QUESTION}\n</question>` }] }],
    systemInstruction: { role: 'system', parts: [{ text: BEHAVIORAL_PROMPT }] },
    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 256 },
  });

  let firstTokenAt = null;
  let chars = 0;
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text.length > 0) {
      if (firstTokenAt === null) firstTokenAt = performance.now();
      chars += text.length;
    }
  }
  const doneAt = performance.now();
  return {
    label,
    model,
    totalMs: Math.round(doneAt - started),
    firstTokenMs: firstTokenAt ? Math.round(firstTokenAt - started) : null,
    chars,
  };
}

async function run(model, n) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = await timeOne(model, `${model}#${i + 1}`);
    console.log(`  ${r.label.padEnd(40)} TTFT=${String(r.firstTokenMs ?? '-').padStart(5)}ms  total=${String(r.totalMs).padStart(5)}ms  chars=${r.chars}`);
    results.push(r);
  }
  return results;
}

function summary(arr) {
  const ttfts = arr.map((r) => r.firstTokenMs ?? 0).filter((n) => n > 0);
  ttfts.sort((a, b) => a - b);
  const median = ttfts.length ? ttfts[Math.floor(ttfts.length / 2)] : 0;
  const min = ttfts.length ? ttfts[0] : 0;
  const max = ttfts.length ? ttfts[ttfts.length - 1] : 0;
  return { median, min, max, n: ttfts.length };
}

console.log('=== gemini-2.5-flash (5 sequential calls) ===');
const flash = await run('gemini-2.5-flash', 5);
console.log('  stats:', summary(flash));

console.log('\n=== gemini-2.5-flash-lite (5 sequential calls) ===');
const lite = await run('gemini-2.5-flash-lite', 5);
console.log('  stats:', summary(lite));

console.log('\n=== comparison ===');
console.log(`  flash median TTFT: ${summary(flash).median}ms`);
console.log(`  lite  median TTFT: ${summary(lite).median}ms`);
console.log(`  target from spec:  < 900ms p50 end-to-end (incl. STT + network + render)`);
