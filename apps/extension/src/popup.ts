/**
 * Popup UI driver. On open:
 *   1. Read stored config (token + apiBaseUrl).
 *   2. If the active tab is a LeetCode problem page, ask the content script for the
 *      extracted problem and preview it.
 *   3. "Get solution" calls the api with the problem + user's JWT, renders the answer.
 *
 * All errors surface in a red banner — never a silent failure.
 */
import { readConfig, writeConfig, clearToken } from './lib/storage';
import { fetchCodingAnswer, ApiError } from './lib/api';
import type { ExtractedProblem } from './lib/leetcode-parser';

type State =
  | { kind: 'idle' }
  | { kind: 'loading-problem' }
  | { kind: 'ready'; problem: ExtractedProblem }
  | { kind: 'no-problem'; reason: string }
  | { kind: 'fetching-answer'; problem: ExtractedProblem }
  | { kind: 'answered'; problem: ExtractedProblem; answer: string; provider: string; latencyMs: number }
  | { kind: 'error'; message: string };

const els = {
  status: document.getElementById('status') as HTMLSpanElement,
  apiUrl: document.getElementById('api-url') as HTMLInputElement,
  token: document.getElementById('token') as HTMLTextAreaElement,
  saveConfig: document.getElementById('save-config') as HTMLButtonElement,
  clearToken: document.getElementById('clear-token') as HTMLButtonElement,
  problemSection: document.getElementById('problem-section') as HTMLElement,
  problemTitle: document.getElementById('problem-title') as HTMLElement,
  problemDifficulty: document.getElementById('problem-difficulty') as HTMLElement,
  problemSlug: document.getElementById('problem-slug') as HTMLElement,
  getSolution: document.getElementById('get-solution') as HTMLButtonElement,
  answerSection: document.getElementById('answer-section') as HTMLElement,
  answerMeta: document.getElementById('answer-meta') as HTMLElement,
  answerText: document.getElementById('answer-text') as HTMLElement,
  errorSection: document.getElementById('error-section') as HTMLElement,
  errorText: document.getElementById('error-text') as HTMLElement,
};

let state: State = { kind: 'idle' };
let config: Awaited<ReturnType<typeof readConfig>> = {};

async function main(): Promise<void> {
  config = await readConfig();
  els.apiUrl.value = config.apiBaseUrl ?? '';
  els.token.value = config.token ?? '';
  render();

  els.saveConfig.addEventListener('click', async () => {
    const apiBaseUrl = els.apiUrl.value.trim();
    const token = els.token.value.trim();
    await writeConfig({
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      ...(token ? { token } : {}),
    });
    config = await readConfig();
    render();
  });

  els.clearToken.addEventListener('click', async () => {
    await clearToken();
    config = await readConfig();
    els.token.value = '';
    render();
  });

  els.getSolution.addEventListener('click', () => void onGetSolution());

  await loadProblemFromActiveTab();
}

async function loadProblemFromActiveTab(): Promise<void> {
  state = { kind: 'loading-problem' };
  render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https:\/\/leetcode\.com\/problems\//.test(tab.url)) {
      state = { kind: 'no-problem', reason: 'Open a LeetCode problem page to extract it.' };
      render();
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'extract-leetcode' });
    if (!response?.ok || !response.problem) {
      state = {
        kind: 'no-problem',
        reason:
          response?.error ?? 'Couldn\u2019t read the problem. Try reloading the LeetCode tab.',
      };
      render();
      return;
    }
    state = { kind: 'ready', problem: response.problem as ExtractedProblem };
    render();
  } catch (err) {
    state = {
      kind: 'no-problem',
      reason:
        'Extension not yet injected on this tab. Reload the LeetCode page and reopen the popup.',
    };
    render();
  }
}

async function onGetSolution(): Promise<void> {
  if (state.kind !== 'ready') return;
  if (!config.token) {
    state = { kind: 'error', message: 'No access token set. Open Config and paste your token.' };
    render();
    return;
  }
  const apiBaseUrl = config.apiBaseUrl ?? 'http://localhost:3001';
  const problem = state.problem;
  state = { kind: 'fetching-answer', problem };
  render();

  try {
    const out = await fetchCodingAnswer({
      apiBaseUrl,
      token: config.token,
      problem: {
        ...(problem.title ? { title: problem.title } : {}),
        ...(problem.description ? { description: problem.description } : {}),
        ...(problem.examples ? { examples: problem.examples } : {}),
        ...(problem.constraints ? { constraints: problem.constraints } : {}),
        ...(problem.difficulty ? { difficulty: problem.difficulty } : {}),
        rawText: problem.rawText,
      },
    });
    state = {
      kind: 'answered',
      problem,
      answer: out.answer,
      provider: out.provider,
      latencyMs: out.latencyMs,
    };
    render();
  } catch (err) {
    const msg = err instanceof ApiError
      ? err.kind === 'auth'
        ? 'Token rejected. Grab a fresh one from /app/settings.'
        : err.message
      : err instanceof Error
        ? err.message
        : String(err);
    state = { kind: 'error', message: msg };
    render();
  }
}

function render(): void {
  const hasToken = !!config.token;
  els.status.textContent = hasToken ? 'signed in' : 'no token';

  // Problem section
  if (state.kind === 'ready' || state.kind === 'fetching-answer' || state.kind === 'answered') {
    const p = state.problem;
    els.problemSection.hidden = false;
    els.problemTitle.textContent = p.title;
    els.problemDifficulty.textContent = p.difficulty ?? '';
    els.problemDifficulty.className = 'pill ' + (p.difficulty?.toLowerCase() ?? '');
    els.problemSlug.textContent = p.slug ? `/problems/${p.slug}` : '';
    els.getSolution.disabled = state.kind === 'fetching-answer' || !hasToken;
    els.getSolution.textContent = state.kind === 'fetching-answer' ? 'Thinking\u2026' : 'Get solution';
  } else {
    els.problemSection.hidden = true;
    els.getSolution.disabled = true;
    els.getSolution.textContent =
      state.kind === 'loading-problem'
        ? 'Loading\u2026'
        : state.kind === 'no-problem'
          ? state.reason
          : 'Get solution';
  }

  // Answer
  if (state.kind === 'answered') {
    els.answerSection.hidden = false;
    els.answerMeta.textContent = `${state.provider} \u00b7 ${state.latencyMs} ms`;
    els.answerText.textContent = state.answer;
  } else {
    els.answerSection.hidden = true;
  }

  // Error
  if (state.kind === 'error') {
    els.errorSection.hidden = false;
    els.errorText.textContent = state.message;
  } else {
    els.errorSection.hidden = true;
  }
}

void main();
