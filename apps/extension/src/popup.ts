/**
 * Popup UI driver. On open:
 *   1. Read stored config (session bundle + apiBaseUrl).
 *   2. If the access token is near expiry, proactively refresh it via Supabase.
 *   3. If the active tab is a LeetCode problem or HackerRank challenge, ask the content
 *      script for the extracted problem and preview it.
 *   4. "Get solution" calls the api with the problem + current JWT; streams the answer
 *      into the pane. If the api returns 401, we refresh once and retry.
 *
 * All errors surface in a red banner — never a silent failure.
 */
import {
  readConfig,
  writeConfig,
  clearSession,
  parseSessionBundle,
  setPendingLogin,
  type ExtensionConfig,
} from './lib/storage';
import { streamCodingAnswer, ApiError } from './lib/api';
import { refreshSupabaseSession, RefreshError, tokenNeedsRefresh } from './lib/refresh';
import type { ExtractedProblem } from './lib/leetcode-parser';

type State =
  | { kind: 'idle' }
  | { kind: 'loading-problem' }
  | { kind: 'ready'; problem: ExtractedProblem }
  | { kind: 'no-problem'; reason: string }
  | { kind: 'fetching-answer'; problem: ExtractedProblem; answer: string; provider: string }
  | { kind: 'answered'; problem: ExtractedProblem; answer: string; provider: string; latencyMs: number }
  | { kind: 'error'; message: string };

const els = {
  status: document.getElementById('status') as HTMLSpanElement,
  signinSection: document.getElementById('signin-section') as HTMLElement,
  webUrl: document.getElementById('web-url') as HTMLInputElement,
  signIn: document.getElementById('sign-in') as HTMLButtonElement,
  apiUrl: document.getElementById('api-url') as HTMLInputElement,
  bundle: document.getElementById('bundle') as HTMLTextAreaElement,
  saveConfig: document.getElementById('save-config') as HTMLButtonElement,
  clearSession: document.getElementById('clear-session') as HTMLButtonElement,
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
  configMessage: document.getElementById('config-message') as HTMLElement,
};

let state: State = { kind: 'idle' };
let config: ExtensionConfig = {};

async function main(): Promise<void> {
  config = await readConfig();
  els.apiUrl.value = config.apiBaseUrl ?? '';
  els.webUrl.value = config.webBaseUrl ?? '';
  render();

  els.signIn.addEventListener('click', () => void onSignIn());

  els.saveConfig.addEventListener('click', async () => {
    const apiBaseUrl = els.apiUrl.value.trim();
    const bundleRaw = els.bundle.value.trim();
    if (bundleRaw.length > 0) {
      const bundle = parseSessionBundle(bundleRaw);
      if (!bundle) {
        showConfigMessage('Pasted session JSON is not valid. Copy fresh from /app/settings.');
        return;
      }
      await writeConfig({
        accessToken: bundle.accessToken,
        refreshToken: bundle.refreshToken,
        expiresAt: bundle.expiresAt,
        supabaseUrl: bundle.supabaseUrl,
        supabaseAnonKey: bundle.supabaseAnonKey,
        apiBaseUrl: bundle.apiBaseUrl ?? apiBaseUrl ?? undefined,
      });
      els.bundle.value = '';
    } else if (apiBaseUrl) {
      await writeConfig({ apiBaseUrl });
    }
    config = await readConfig();
    showConfigMessage('Saved.');
    render();
  });

  els.clearSession.addEventListener('click', async () => {
    await clearSession();
    config = await readConfig();
    render();
  });

  els.getSolution.addEventListener('click', () => void onGetSolution());

  // Proactive refresh on open — if the token is close to expiring, silently renew so
  // the first click doesn't have to retry.
  if (config.refreshToken && tokenNeedsRefresh(config.expiresAt)) {
    await tryRefresh();
  }

  await loadProblemFromActiveTab();
}

interface SiteMatch {
  readonly site: 'leetcode' | 'hackerrank';
  readonly messageType: 'extract-leetcode' | 'extract-hackerrank';
  readonly label: string;
}

function detectSite(url: string): SiteMatch | null {
  if (/^https:\/\/leetcode\.com\/problems\//.test(url)) {
    return { site: 'leetcode', messageType: 'extract-leetcode', label: 'LeetCode' };
  }
  if (/^https:\/\/www\.hackerrank\.com\/challenges\//.test(url)) {
    return { site: 'hackerrank', messageType: 'extract-hackerrank', label: 'HackerRank' };
  }
  return null;
}

async function loadProblemFromActiveTab(): Promise<void> {
  state = { kind: 'loading-problem' };
  render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const match = tab?.url ? detectSite(tab.url) : null;
    if (!tab?.id || !match) {
      state = {
        kind: 'no-problem',
        reason: 'Open a LeetCode problem or HackerRank challenge page to extract it.',
      };
      render();
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: match.messageType });
    if (!response?.ok || !response.problem) {
      state = {
        kind: 'no-problem',
        reason:
          response?.error ??
          `Couldn\u2019t read the problem. Try reloading the ${match.label} tab.`,
      };
      render();
      return;
    }
    state = { kind: 'ready', problem: response.problem as ExtractedProblem };
    render();
  } catch {
    state = {
      kind: 'no-problem',
      reason:
        'Extension not yet injected on this tab. Reload the problem page and reopen the popup.',
    };
    render();
  }
}

async function onSignIn(): Promise<void> {
  // Persist the chosen web URL (so next popup open defaults to the same one).
  const webBaseUrl = els.webUrl.value.trim() || 'http://localhost:3000';
  await writeConfig({ webBaseUrl });
  config = await readConfig();

  // 128-bit nonce so the callback can verify this wasn't triggered by a malicious page.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await setPendingLogin(nonce);

  const extensionId = chrome.runtime.id;
  const url = new URL('/login', webBaseUrl);
  url.searchParams.set('from', 'extension');
  url.searchParams.set('extension_id', extensionId);
  url.searchParams.set('state', nonce);

  // Open in a new tab; the callback page closes itself once done.
  await chrome.tabs.create({ url: url.toString() });
  window.close();
}

async function tryRefresh(): Promise<boolean> {
  if (!config.refreshToken || !config.supabaseUrl || !config.supabaseAnonKey) return false;
  try {
    const out = await refreshSupabaseSession({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      refreshToken: config.refreshToken,
    });
    await writeConfig({
      accessToken: out.accessToken,
      refreshToken: out.refreshToken,
      expiresAt: out.expiresAt,
    });
    config = await readConfig();
    return true;
  } catch (err) {
    if (err instanceof RefreshError && err.status === 400) {
      // Refresh token itself is stale — user must regrab bundle.
      return false;
    }
    return false;
  }
}

async function onGetSolution(): Promise<void> {
  if (state.kind !== 'ready') return;
  if (!config.accessToken) {
    state = { kind: 'error', message: 'No access token. Paste a session bundle in Config.' };
    render();
    return;
  }
  const apiBaseUrl = config.apiBaseUrl ?? 'http://localhost:3001';
  const problem = state.problem;

  const run = async (): Promise<
    { ok: true; answer: string; provider: string; latencyMs: number } | { ok: false; err: unknown }
  > => {
    state = { kind: 'fetching-answer', problem, answer: '', provider: '' };
    render();
    try {
      let accum = '';
      let provider = '';
      let latencyMs = 0;
      for await (const ev of streamCodingAnswer({
        apiBaseUrl,
        token: config.accessToken!,
        problem: {
          ...(problem.title ? { title: problem.title } : {}),
          ...(problem.description ? { description: problem.description } : {}),
          ...(problem.examples ? { examples: problem.examples } : {}),
          ...(problem.constraints ? { constraints: problem.constraints } : {}),
          ...(problem.difficulty ? { difficulty: problem.difficulty } : {}),
          rawText: problem.rawText,
        },
      })) {
        if (ev.kind === 'start') {
          provider = ev.provider;
          state = { kind: 'fetching-answer', problem, answer: '', provider };
          render();
        } else if (ev.kind === 'delta') {
          accum += ev.text;
          state = { kind: 'fetching-answer', problem, answer: accum, provider };
          render();
        } else if (ev.kind === 'done') {
          latencyMs = ev.latencyMs;
          return { ok: true, answer: accum, provider: ev.provider, latencyMs };
        } else if (ev.kind === 'error') {
          return { ok: false, err: new Error(ev.message) };
        }
      }
      return { ok: true, answer: accum, provider, latencyMs };
    } catch (err) {
      return { ok: false, err };
    }
  };

  let result = await run();
  if (!result.ok && result.err instanceof ApiError && result.err.kind === 'auth') {
    // One-shot retry after refresh.
    const refreshed = await tryRefresh();
    if (refreshed) result = await run();
  }
  if (result.ok) {
    state = {
      kind: 'answered',
      problem,
      answer: result.answer,
      provider: result.provider,
      latencyMs: result.latencyMs,
    };
    render();
    return;
  }
  const err = result.err;
  const msg =
    err instanceof ApiError
      ? err.kind === 'auth'
        ? 'Token rejected and refresh failed. Regrab session JSON from /app/settings.'
        : err.message
      : err instanceof Error
        ? err.message
        : String(err);
  state = { kind: 'error', message: msg };
  render();
}

function showConfigMessage(msg: string): void {
  els.configMessage.textContent = msg;
  setTimeout(() => {
    if (els.configMessage.textContent === msg) els.configMessage.textContent = '';
  }, 3_000);
}

function render(): void {
  const hasToken = !!config.accessToken;
  const canRefresh = !!(config.refreshToken && config.supabaseUrl && config.supabaseAnonKey);
  els.status.textContent = hasToken
    ? canRefresh
      ? 'signed in'
      : 'signed in (no auto-refresh)'
    : 'no session';

  // Show the Sign-in section only when we have no session at all. Config panel stays
  // accessible either way for users who prefer to paste the JSON bundle manually.
  els.signinSection.hidden = hasToken;

  // Problem section
  if (state.kind === 'ready' || state.kind === 'fetching-answer' || state.kind === 'answered') {
    const p = state.problem;
    els.problemSection.hidden = false;
    els.problemTitle.textContent = p.title;
    els.problemDifficulty.textContent = p.difficulty ?? '';
    els.problemDifficulty.className = 'pill ' + (p.difficulty?.toLowerCase() ?? '');
    els.problemSlug.textContent = p.slug ? `/${p.slug}` : '';
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

  // Answer — show while streaming too, so the user watches it land.
  if (state.kind === 'answered') {
    els.answerSection.hidden = false;
    els.answerMeta.textContent = `${state.provider} \u00b7 ${state.latencyMs} ms`;
    els.answerText.textContent = state.answer;
  } else if (state.kind === 'fetching-answer' && state.answer.length > 0) {
    els.answerSection.hidden = false;
    els.answerMeta.textContent = state.provider
      ? `${state.provider} \u00b7 streaming\u2026`
      : 'streaming\u2026';
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
