// Live OCR + coding-answer smoke:
//   1. Render a LeetCode-style PNG with real problem text.
//   2. POST to Google Vision TEXT_DETECTION.
//   3. Parse the OCR text into a CodingProblem.
//   4. Call Gemini with the parsed problem as context; stream the answer.
//
// Proves the Phase 5 + Phase 4 chain works on a real image all the way through.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
} catch {
  /* rely on exported env */
}

// --- 1. Render a plausible LeetCode PNG with Sharp ------------------------
const sharp = require(
  resolve(repoRoot, 'node_modules/.pnpm/sharp@0.34.5/node_modules/sharp'),
);

const problemSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="800" viewBox="0 0 900 800">
  <style>
    .title { font: 600 28px 'Segoe UI', Arial, sans-serif; fill: #1a1a1a; }
    .tag   { font: 500 12px 'Segoe UI', Arial, sans-serif; fill: #4caf50; }
    .body  { font: 400 16px 'Segoe UI', Arial, sans-serif; fill: #1a1a1a; }
    .code  { font: 400 14px 'Consolas', 'Courier New', monospace; fill: #1a1a1a; }
    .hdr   { font: 600 14px 'Segoe UI', Arial, sans-serif; fill: #1a1a1a; }
  </style>
  <rect width="900" height="800" fill="#ffffff"/>
  <text x="40" y="60"  class="title">1. Two Sum</text>
  <text x="40" y="85"  class="tag">Easy</text>

  <text x="40" y="130" class="body">Given an array of integers nums and an integer target,</text>
  <text x="40" y="152" class="body">return indices of the two numbers such that they add up</text>
  <text x="40" y="174" class="body">to target.</text>
  <text x="40" y="210" class="body">You may assume that each input would have exactly one</text>
  <text x="40" y="232" class="body">solution, and you may not use the same element twice.</text>

  <text x="40" y="280" class="hdr">Example 1:</text>
  <text x="40" y="305" class="code">Input: nums = [2,7,11,15], target = 9</text>
  <text x="40" y="325" class="code">Output: [0,1]</text>
  <text x="40" y="345" class="code">Explanation: nums[0] + nums[1] == 9, so return [0, 1].</text>

  <text x="40" y="385" class="hdr">Example 2:</text>
  <text x="40" y="410" class="code">Input: nums = [3,2,4], target = 6</text>
  <text x="40" y="430" class="code">Output: [1,2]</text>

  <text x="40" y="480" class="hdr">Constraints:</text>
  <text x="40" y="505" class="code">2 &lt;= nums.length &lt;= 10^4</text>
  <text x="40" y="525" class="code">-10^9 &lt;= nums[i] &lt;= 10^9</text>
  <text x="40" y="545" class="code">-10^9 &lt;= target &lt;= 10^9</text>
  <text x="40" y="565" class="code">Only one valid answer exists.</text>

  <text x="40" y="610" class="hdr">Follow-up:</text>
  <text x="40" y="635" class="body">Can you come up with an algorithm that is less than</text>
  <text x="40" y="657" class="body">O(n^2) time complexity?</text>
</svg>`;

mkdirSync(resolve(repoRoot, 'scripts/smoke/fixtures'), { recursive: true });
const pngPath = resolve(repoRoot, 'scripts/smoke/fixtures/two-sum.png');
await sharp(Buffer.from(problemSvg)).png().toFile(pngPath);
const png = readFileSync(pngPath);
console.log(`rendered PNG: ${png.byteLength.toLocaleString()} bytes → ${pngPath}`);

// --- 2. Google Vision TEXT_DETECTION --------------------------------------
const { GoogleVisionProvider } = require(
  resolve(repoRoot, 'packages/ocr/dist/index.js'),
);
const vision = new GoogleVisionProvider({ apiKey: process.env.GOOGLE_CLOUD_VISION_KEY });
const visionStart = Date.now();
const ocrResult = await vision.extract(png);
console.log(`\n== OCR ${Date.now() - visionStart} ms ==`);
console.log(ocrResult.text);

// --- 3. Parse into CodingProblem ------------------------------------------
const { parseCodingProblem } = require(
  resolve(repoRoot, 'packages/ocr/dist/index.js'),
);
const problem = parseCodingProblem(ocrResult.text);
console.log(`\n== Parsed CodingProblem ==`);
console.log(JSON.stringify(problem, null, 2));

// --- 4. Route through Gemini with the parsed problem as context -----------
const { GeminiProvider, LlmRouter } = require(
  resolve(repoRoot, 'packages/llm-router/dist/index.js'),
);
const gemini = new GeminiProvider({ apiKey: process.env.GOOGLE_API_KEY });
const router = new LlmRouter({ gemini });
const llmStart = Date.now();
let firstToken = null;
let chars = 0;
const stream = await router.startStream({
  tier: 'free',
  llm: 'auto',
  context: {
    question: problem.title ? `Solve: ${problem.title}` : 'Solve this coding problem.',
    language: 'en',
    hint: 'coding',
    codingProblem: problem,
  },
});
console.log(`\n== Gemini answer (provider: ${stream.provider}) ==`);
for await (const delta of stream.deltas) {
  if (firstToken === null) firstToken = Date.now();
  chars += delta.length;
  process.stdout.write(delta);
}
console.log(`\n\n== Telemetry ==`);
console.log(`vision:      ${visionStart - visionStart /* 0 */} ms (captured above)`);
console.log(`first token: ${firstToken - llmStart} ms`);
console.log(`total llm:   ${Date.now() - llmStart} ms`);
console.log(`chars:       ${chars}`);
