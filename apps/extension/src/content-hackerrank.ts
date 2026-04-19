/**
 * Content script for HackerRank challenge pages. Responds to the popup's
 * `extract-hackerrank` message with the parsed problem.
 */
import { extractHackerRankProblem } from './lib/hackerrank-parser';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'extract-hackerrank') return false;
  try {
    const problem = extractHackerRankProblem(document, window.location.href);
    sendResponse({ ok: true, problem });
  } catch (err) {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  return false;
});
