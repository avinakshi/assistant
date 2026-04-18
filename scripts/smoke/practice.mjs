// Live practice-mode smoke: drive the interviewer through opening → turn → finalize
// using the real Gemini key and real prompt pack. Prints what the LLM returns so the
// operator can judge quality.

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

const { buildOpeningPrompt, buildTurnPrompt, buildFinalizePrompt } = require(
  resolve(repoRoot, 'packages/prompts/dist/interviewer.js'),
);
const { GoogleGenerativeAI } = require(
  resolve(repoRoot, 'apps/web/node_modules/@google/generative-ai'),
);

const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = client.getGenerativeModel({
  model: 'gemini-2.5-flash-lite',
  generationConfig: { responseMimeType: 'application/json', temperature: 0.6 },
});

async function ask(prompt) {
  const t0 = Date.now();
  const res = await model.generateContent(prompt);
  const raw = res.response.text();
  const elapsed = Date.now() - t0;
  return { raw, elapsed, parsed: JSON.parse(raw) };
}

console.log('== Phase 8a: Practice interviewer flow (behavioral, Senior SRE @ Stripe) ==\n');

// 1. Opening question
const opening = await ask(
  buildOpeningPrompt('behavioral', { role: 'Senior SRE', company: 'Stripe', maxQuestions: 2 }),
);
console.log(`[opening ${opening.elapsed} ms]`);
console.log(`  Q1: ${opening.parsed.question}\n`);

// 2. Simulate a candidate answer
const answer1 =
  "Two years ago I owned the on-call rotation for our billing service. We had a pager storm " +
  "after a bad config push — 18 alerts in 40 minutes. I rolled back first, then wrote a " +
  "post-mortem the next morning. We added a dry-run guard for config changes and the pager " +
  "volume dropped by 70% the following quarter.";

const turn1 = await ask(
  buildTurnPrompt({
    mode: 'behavioral',
    ctx: { role: 'Senior SRE', company: 'Stripe', maxQuestions: 2 },
    history: [{ question: opening.parsed.question, answer: answer1 }],
    latestAnswer: answer1,
    questionsAskedSoFar: 1,
  }),
);
console.log(`[turn1 ${turn1.elapsed} ms]`);
console.log(`  A1: (candidate) ${answer1.slice(0, 80)}...`);
console.log(`  Scores: ${JSON.stringify(turn1.parsed.scores)}`);
console.log(`  Notes:  ${turn1.parsed.notes}`);
console.log(`  Q2:     ${turn1.parsed.nextQuestion}\n`);

// 3. Another candidate answer
const answer2 =
  "I try to start every 1:1 with something non-work. Builds enough trust that people raise " +
  "incidents early. The best indicator of a healthy on-call rotation isn't MTTR — it's how " +
  "quickly someone says 'I'm lost, I need help'.";

const turn2 = await ask(
  buildTurnPrompt({
    mode: 'behavioral',
    ctx: { role: 'Senior SRE', company: 'Stripe', maxQuestions: 2 },
    history: [
      { question: opening.parsed.question, answer: answer1 },
      { question: turn1.parsed.nextQuestion, answer: answer2 },
    ],
    latestAnswer: answer2,
    questionsAskedSoFar: 2,
  }),
);
console.log(`[turn2 ${turn2.elapsed} ms]`);
console.log(`  A2: (candidate) ${answer2.slice(0, 80)}...`);
console.log(`  Scores: ${JSON.stringify(turn2.parsed.scores)}`);
console.log(`  Notes:  ${turn2.parsed.notes}`);
console.log(`  Next:   ${turn2.parsed.nextQuestion === null ? '(session ends)' : turn2.parsed.nextQuestion}\n`);

// 4. Finalize
const finalize = await ask(
  buildFinalizePrompt({
    mode: 'behavioral',
    ctx: { role: 'Senior SRE', company: 'Stripe' },
    history: [
      { question: opening.parsed.question, answer: answer1 },
      { question: turn1.parsed.nextQuestion, answer: answer2 },
    ],
    turnScores: [turn1.parsed.scores, turn2.parsed.scores],
  }),
);
console.log(`[finalize ${finalize.elapsed} ms]`);
console.log(`  Overall scores: ${JSON.stringify(finalize.parsed.scores)}`);
console.log(`  Highlights:`);
for (const h of finalize.parsed.highlights) console.log(`    - ${h}`);
console.log(`  Improvements:`);
for (const i of finalize.parsed.improvements) console.log(`    - ${i}`);
