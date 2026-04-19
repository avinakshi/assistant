/**
 * Content script for LeetCode problem pages. Listens for a message from the popup
 * asking "what's on this page?" and responds with the parsed problem.
 *
 * We don't proactively extract on page load — the DOM takes a beat to render, and
 * we'd rather do the work once on demand when the popup opens.
 */
import { extractLeetCodeProblem } from './lib/leetcode-parser';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'extract-leetcode') return false;
  try {
    const problem = extractLeetCodeProblem(document, window.location.href);
    sendResponse({ ok: true, problem });
  } catch (err) {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  // `false` tells Chrome we responded synchronously.
  return false;
});
